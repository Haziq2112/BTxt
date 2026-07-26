from flask import Blueprint, render_template, redirect, session, jsonify, make_response

from database import (
    get_all_profiles, get_suspended_users, get_banned_ips,
    suspend_user, resume_user, ban_ip, unban_ip, get_user_ip,
    add_deleted_user, delete_user, get_deleted_users,
    restore_user, delete_user_forever
)

admin_bp = Blueprint("admin", __name__)

ADMIN_USERNAME = "hazii"


def is_admin():
    return session.get("username", "").lower() == ADMIN_USERNAME


def no_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


def build_admin_context():

    profiles = get_all_profiles()
    usernames = [p.username for p in profiles]

    user_ips = {}
    for name in usernames:
        ip = get_user_ip(name)
        if ip:
            user_ips[name] = ip

    return {
        "users": usernames,
        "total_users": len(usernames),
        "user_ips": user_ips,
        "suspended_users": get_suspended_users(),
        "banned_ips": get_banned_ips()
    }


@admin_bp.route("/admin")
def admin():

    if "username" not in session:
        return redirect("/login")

    if not is_admin():
        return redirect("/chats")

    context = build_admin_context()
    context["username"] = session["username"]

    response = make_response(render_template("admin.html", **context))

    return no_cache(response)


@admin_bp.route("/admin/content")
def admin_content():

    if not is_admin():
        return "", 403

    return render_template("admin_content.html", **build_admin_context())


@admin_bp.route("/admin/delete/<username>", methods=["POST"])
def admin_delete(username):

    if not is_admin():
        return jsonify({"success": False}), 403

    username = username.strip().lower()

    if username == ADMIN_USERNAME:
        return jsonify({"success": False, "message": "Cannot delete the admin account."})

    add_deleted_user(username, deleted_by=session["username"])
    delete_user(username)

    return jsonify({"success": True})


@admin_bp.route("/admin/deleteforever/<username>", methods=["POST"])
def admin_delete_forever(username):

    if not is_admin():
        return jsonify({"success": False}), 403

    delete_user_forever(username.strip().lower())

    return jsonify({"success": True})


@admin_bp.route("/admin/suspend/<username>", methods=["POST"])
def admin_suspend(username):

    if not is_admin():
        return jsonify({"success": False}), 403

    suspend_user(username.strip().lower())

    return jsonify({"success": True})


@admin_bp.route("/admin/resume/<username>", methods=["POST"])
def admin_resume(username):

    if not is_admin():
        return jsonify({"success": False}), 403

    resume_user(username.strip().lower())

    return jsonify({"success": True})


@admin_bp.route("/admin/banip/<username>", methods=["POST"])
def admin_banip(username):

    if not is_admin():
        return jsonify({"success": False}), 403

    ip = get_user_ip(username.strip().lower())

    if ip:
        ban_ip(ip)

    return jsonify({"success": True})


@admin_bp.route("/admin/unbanip/<username>", methods=["POST"])
def admin_unbanip(username):

    if not is_admin():
        return jsonify({"success": False}), 403

    ip = get_user_ip(username.strip().lower())

    if ip:
        unban_ip(ip)

    return jsonify({"success": True})


@admin_bp.route("/admin/unbanipdirect/<ip>", methods=["POST"])
def admin_unban_ip_direct(ip):

    if not is_admin():
        return jsonify({"success": False}), 403

    unban_ip(ip)

    return jsonify({"success": True})


@admin_bp.route("/admin/restore/<username>", methods=["POST"])
def admin_restore(username):

    if not is_admin():
        return jsonify({"success": False}), 403

    restore_user(username.strip().lower())

    return jsonify({"success": True})


@admin_bp.route("/admin/deleted")
def deleted_accounts():

    if not is_admin():
        return redirect("/chats")

    response = make_response(render_template(
        "deleted_accounts.html",
        username=session["username"],
        users=get_deleted_users()
    ))

    return no_cache(response)


@admin_bp.route("/admin/deleted/list")
def deleted_accounts_list():

    if not is_admin():
        return "", 403

    return render_template(
        "deleted_accounts_list.html",
        users=get_deleted_users()
    )
