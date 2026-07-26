import time
from datetime import datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

from flask import (
    Blueprint, render_template, request, redirect,
    session, jsonify, flash, make_response
)

from database import (
    get_contacts, add_contact, get_all_users, save_message,
    get_messages, edit_message, get_last_message,
    delete_message_everyone, remove_contact, get_profile_picture,
    delete_message_for_me
)

messages_bp = Blueprint("messages", __name__)

last_active = {}


def update_activity(username):
    if username:
        last_active[username] = time.time()


def is_online(username):
    if username not in last_active:
        return False
    return time.time() - last_active[username] < 5


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

    for user in users:
        last_messages[user] = get_last_message(current_user, user)
        profile_pictures[user] = get_profile_picture(user)

    response = make_response(render_template(
        "chats.html",
        username=current_user,
        users=users,
        is_online=is_online,
        last_messages=last_messages,
        profile_pictures=profile_pictures
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
        is_online=is_online,
        profile_picture=get_profile_picture(chatwith)
    ))

    return no_cache(response)


@messages_bp.route("/add_user", methods=["POST"])
def add_user_route():

    if "username" not in session:
        return redirect("/login")

    current_user = session["username"]
    new_user = request.form.get("newuser", "").strip().lower()

    users = get_all_users()
    contacts = get_contacts(current_user)

    if new_user not in users:
        flash("Username not found")
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

    save_message(sender, receiver, message, timestamp, reply_text, reply_self)

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

    rows = get_messages(username, chatwith)

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

    return jsonify({user: is_online(user) for user in last_active})
