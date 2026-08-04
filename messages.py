import time
from datetime import datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

from flask import (
    Blueprint, render_template, request, redirect,
    session, jsonify, flash, make_response
)

from database import (
    get_contacts, add_contact, save_message, username_exists,
    get_messages, edit_message, get_last_message, mark_messages_seen,
    get_unread_count, delete_message_everyone, remove_contact,
    get_profile_picture, delete_message_for_me,
    set_reaction, remove_reaction, get_reaction, get_reactions_for_conversation,
    toggle_pin, get_pinned_messages, get_user_by_btext_id,
    update_last_seen, get_privacy_settings
)

messages_bp = Blueprint("messages", __name__)

last_active = {}

# Throttles how often we write last_seen to the database — writing on
# every single 700ms poll would be excessive; once every ~20s while
# someone's active is plenty for a "last seen" feature to feel accurate.
last_persisted_seen = {}
PERSIST_INTERVAL = 20


def update_activity(username):

    if not username:
        return

    last_active[username] = time.time()

    now = time.time()
    last_persisted = last_persisted_seen.get(username, 0)

    if now - last_persisted > PERSIST_INTERVAL:
        last_persisted_seen[username] = now
        formatted = datetime.now(IST).strftime("%d %b, %I:%M %p")
        update_last_seen(username, formatted)


def is_online(username):
    if username not in last_active:
        return False
    return time.time() - last_active[username] < 5


def is_online_visible(username):
    # Respects that user's own privacy setting — if they've hidden
    # their online status, everyone sees them as offline regardless
    # of whether they're actually active right now.
    settings = get_privacy_settings(username)

    if settings and not settings.show_online:
        return False

    return is_online(username)


def get_visible_last_seen(username):
    settings = get_privacy_settings(username)

    if not settings or not settings.show_last_seen:
        return None

    return settings.last_seen or None


# Typing status is transient — no reason to persist it in the
# database, an in-memory dict works the same way last_active does.
typing_status = {}


def set_typing(typer, recipient):
    typing_status[(typer, recipient)] = time.time()


def is_typing(typer, recipient):
    key = (typer, recipient)
    if key not in typing_status:
        return False
    return time.time() - typing_status[key] < 3


def no_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@messages_bp.route("/delete_chat", methods=["POST"])
def delete_chat():

    if "username" not in session:
        return redirect("/login")

    current_user = session["username"]
    other_user = request.form.get("user")

    remove_contact(current_user, other_user)

    return redirect("/chats")


@messages_bp.route("/chats")
def chats():

    if "username" not in session:
        return redirect("/login")

    current_user = session["username"]
    update_activity(current_user)

    users = get_contacts(current_user)

    last_messages = {}
    profile_pictures = {}
    unread_counts = {}

    for user in users:
        last_messages[user] = get_last_message(current_user, user)
        profile_pictures[user] = get_profile_picture(user)
        unread_counts[user] = get_unread_count(current_user, user)

    response = make_response(render_template(
        "chats.html",
        username=current_user,
        users=users,
        is_online=is_online,
        last_messages=last_messages,
        profile_pictures=profile_pictures,
        unread_counts=unread_counts
    ))

    return no_cache(response)


@messages_bp.route("/chat/<chatwith>")
def chat(chatwith):

    if "username" not in session:
        return redirect("/login")

    username = session["username"]
    update_activity(username)

    response = make_response(render_template(
        "index.html",
        username=username,
        chatwith=chatwith,
        is_online=is_online_visible,
        last_seen=get_visible_last_seen(chatwith),
        profile_picture=get_profile_picture(chatwith)
    ))

    return no_cache(response)


@messages_bp.route("/add_user", methods=["POST"])
def add_user_route():

    if "username" not in session:
        return redirect("/login")

    current_user = session["username"]
    raw_input = request.form.get("newuser", "").strip()

    # Accept either a plain username or a BTxt ID (format BTX-XXXXXX)
    # so people can add each other without needing to know the exact
    # username spelling/case.
    if raw_input.upper().startswith("BTX-"):
        match = get_user_by_btext_id(raw_input.upper())
        new_user = match.username if match else None
    else:
        new_user = raw_input.lower()

    contacts = get_contacts(current_user)

    if not new_user or not username_exists(new_user):
        flash("User not found")
        return redirect("/chats")

    if new_user == current_user:
        flash("You cannot add yourself")
        return redirect("/chats")

    if new_user in contacts:
        flash("User already added")
        return redirect("/chats")

    add_contact(current_user, new_user)
    add_contact(new_user, current_user)

    flash("User added successfully")

    return redirect("/chats")


@messages_bp.route("/send", methods=["POST"])
def send():

    if "username" not in session:
        return "", 403

    sender = session["username"]
    receiver = request.form.get("chatwith")
    message = request.form.get("message")

    if not sender or not receiver or not message:
        return "", 204

    timestamp = datetime.now(IST).strftime("%I:%M %p")

    reply_text = request.form.get("reply_text", "")
    reply_self = request.form.get("reply_self") == "true"
    reply_to_id = request.form.get("reply_to_id") or None

    save_message(sender, receiver, message, timestamp, reply_text, reply_self, reply_to_id)

    add_contact(sender, receiver)
    add_contact(receiver, sender)

    update_activity(sender)

    return "", 204


@messages_bp.route("/messages")
def messages():

    if "username" not in session:
        return jsonify({"messages": []})

    # The logged-in user can only ever read their own conversations —
    # trusting a username from query params would let anyone read
    # anyone else's messages just by changing the URL.
    username = session["username"]
    chatwith = request.args.get("chatwith")

    update_activity(username)

    if not chatwith:
        return jsonify({"messages": []})

    # The viewer is actively polling this exact chat right now —
    # that means anything the other person sent them is being seen
    # this instant.
    mark_messages_seen(username, chatwith)

    rows = get_messages(username, chatwith)
    reactions_map = get_reactions_for_conversation(username, chatwith)

    result = []

    for row in rows:

        deleted_for = row.deleted_for.split(",") if row.deleted_for else []

        result.append({
            "id": row.id,
            "sender": row.sender,
            "receiver": row.receiver,
            "text": row.message,
            "time": row.timestamp,
            "edited": bool(row.edited),
            "reply_text": row.reply_text,
            "reply_self": bool(row.reply_self),
            "seen": bool(row.seen),
            "reply_to_id": row.reply_to_id,
            "pinned": bool(row.pinned),
            "reactions": reactions_map.get(row.id, []),
            "deleted": bool(row.deleted_everyone),
            "deleted_for": deleted_for
        })

    return jsonify({"messages": result})


@messages_bp.route("/edit_message", methods=["POST"])
def edit_message_route():

    if "username" not in session:
        return jsonify({"success": False}), 403

    data = request.json
    message_id = data.get("message_id")
    new_text = data.get("new_text")

    success = edit_message(message_id, session["username"], new_text)

    return jsonify({"success": success})


@messages_bp.route("/delete_message", methods=["POST"])
def delete_message_route():

    if "username" not in session:
        return jsonify({"success": False}), 403

    data = request.json
    username = session["username"]
    message_id = data.get("message_id")
    mode = data.get("mode")

    if mode == "everyone":
        success = delete_message_everyone(message_id, username)
    elif mode == "me":
        success = delete_message_for_me(message_id, username)
    else:
        success = False

    return jsonify({"success": success})


@messages_bp.route("/online_status")
def online_status():

    return jsonify({user: is_online_visible(user) for user in last_active})


@messages_bp.route("/typing", methods=["POST"])
def typing_route():

    if "username" not in session:
        return "", 403

    chatwith = request.form.get("chatwith")

    if chatwith:
        set_typing(session["username"], chatwith)

    return "", 204


@messages_bp.route("/typing_status")
def typing_status_route():

    if "username" not in session:
        return jsonify({"typing": False})

    chatwith = request.args.get("chatwith", "")
    username = session["username"]

    return jsonify({"typing": is_typing(chatwith, username)})


@messages_bp.route("/react", methods=["POST"])
def react_route():

    if "username" not in session:
        return jsonify({"success": False}), 403

    data = request.json
    username = session["username"]
    message_id = data.get("message_id")
    emoji = data.get("emoji")

    if not message_id or not emoji:
        return jsonify({"success": False}), 400

    # Tapping the same emoji you already reacted with removes it —
    # a toggle, same as most chat apps. A different emoji replaces
    # your previous reaction (one reaction per person per message).
    existing = get_reaction(message_id, username)

    if existing == emoji:
        remove_reaction(message_id, username)
        reacted = False
    else:
        set_reaction(message_id, username, emoji)
        reacted = True

    return jsonify({"success": True, "reacted": reacted})


@messages_bp.route("/toggle_pin", methods=["POST"])
def toggle_pin_route():

    if "username" not in session:
        return jsonify({"success": False}), 403

    data = request.json
    message_id = data.get("message_id")
    pin = data.get("pin", True)

    success = toggle_pin(message_id, pin)

    return jsonify({"success": success})


@messages_bp.route("/pinned")
def pinned_route():

    if "username" not in session:
        return jsonify({"pinned": []})

    username = session["username"]
    chatwith = request.args.get("chatwith", "")

    rows = get_pinned_messages(username, chatwith)

    return jsonify({
        "pinned": [
            {"id": row.id, "sender": row.sender, "text": row.message}
            for row in rows
        ]
    })


@messages_bp.route("/contacts_list")
def contacts_list_route():

    if "username" not in session:
        return jsonify({"contacts": []})

    contacts = get_contacts(session["username"])

    return jsonify({"contacts": contacts})
