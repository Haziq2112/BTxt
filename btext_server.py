import os
import secrets
from datetime import timedelta

from flask import Flask, render_template, request, redirect, session, jsonify
from werkzeug.security import check_password_hash

from database import (
    init_db,
    get_user,
    add_user,
    get_ip_users,
    add_ip_user,
    set_user_ip,
    get_banned_users,
    get_suspended_users,
    get_banned_ips,
    is_deleted
)

from messages import messages_bp
from admin import admin_bp
from profile import profile_bp

app = Flask(__name__)

app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))
app.permanent_session_lifetime = timedelta(days=365)

app.register_blueprint(messages_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(profile_bp)


@app.route("/")
def home():

    if "username" not in session:
        return redirect("/login")

    return redirect("/chats")


@app.route("/signup", methods=["GET", "POST"])
def signup():

    if request.method == "GET":
        return render_template("signup.html")

    username = request.form.get("username", "").strip().lower()
    password = request.form.get("password", "")
    confirm = request.form.get("confirm", "")
    ip = request.remote_addr

    if len(get_ip_users(ip)) >= 3:
        return jsonify({
            "success": False,
            "field": "username",
            "message": "Maximum accounts reached for this IP."
        })

    if get_user(username):
        return jsonify({
            "success": False,
            "field": "username",
            "message": "Username already exists."
        })

    if len(password) < 8:
        return jsonify({
            "success": False,
            "field": "password",
            "message": "Password must be at least 8 characters."
        })

    if password != confirm:
        return jsonify({
            "success": False,
            "field": "confirm",
            "message": "Passwords do not match."
        })

    add_user(username, password)
    add_ip_user(ip, username)
    set_user_ip(username, ip)

    session.permanent = True
    session["username"] = username

    return jsonify({
        "success": True,
        "redirect": "/"
    })


@app.route("/check_username")
def check_username():

    username = request.args.get("username", "").strip().lower()

    if username == "":
        return jsonify({"available": False, "message": ""})

    if get_user(username):
        return jsonify({"available": False, "message": "Username unavailable"})

    return jsonify({"available": True, "message": "Username available"})


@app.route("/login", methods=["GET", "POST"])
def login():

    if request.method == "GET":

        if "username" in session:
            return redirect("/")

        return render_template("login.html")

    username = request.form.get("username", "").strip().lower()
    password = request.form.get("password", "")
    ip = request.remote_addr

    if ip in get_banned_ips():
        return jsonify({
            "success": False,
            "field": "password",
            "message": "This device has been banned."
        })

    if username in get_banned_users():
        return jsonify({
            "success": False,
            "field": "password",
            "message": "This account has been banned."
        })

    if username in get_suspended_users():
        return jsonify({
            "success": False,
            "field": "password",
            "message": "This account has been suspended."
        })

    user = get_user(username)

    if not user:
        return jsonify({
            "success": False,
            "field": "username",
            "message": "Username doesn't exist."
        })

    if is_deleted(username):
        return jsonify({
            "success": False,
            "field": "password",
            "message": "This account has been deleted."
        })

    if not check_password_hash(user.password, password):
        return jsonify({
            "success": False,
            "field": "password",
            "message": "Username or password is incorrect."
        })

    session.permanent = True
    session["username"] = username

    return jsonify({
        "success": True,
        "redirect": "/"
    })


@app.route("/logout")
def logout():

    session.clear()

    return redirect("/login")


if __name__ == "__main__":

    init_db()

    port = int(os.environ.get("PORT", 10000))
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"

    app.run(
        host="0.0.0.0",
        port=port,
        debug=debug_mode
    )
