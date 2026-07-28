import os
import secrets
from datetime import timedelta

from werkzeug.middleware.proxy_fix import ProxyFix

from flask import Flask, render_template, request, redirect, session, jsonify, make_response
from werkzeug.security import check_password_hash

from database import (
    init_db,
    get_user,
    add_user,
    get_ip_users,
    add_ip_user,
    set_user_ip,
    is_banned,
    is_suspended,
    get_banned_ips,
    is_deleted
)

from messages import messages_bp
from admin import admin_bp
from profile import profile_bp

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)

app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))
app.permanent_session_lifetime = timedelta(days=365)

app.register_blueprint(messages_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(profile_bp)


def no_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# Routes that respond with JSON (fetch/AJAX calls) rather than a
# full page — if a session gets invalidated mid-request on one of
# these, the person should get a JSON signal their JS can react to,
# not an HTML redirect their fetch() call can't do anything with.
JSON_RESPONSE_PATH_PREFIXES = (
    "/messages",
    "/send",
    "/edit_message",
    "/delete_message",
    "/online_status",
    "/check_username",
    "/profile/check_username",
    "/admin/",
)


@app.before_request
def enforce_valid_session():

    # Runs before every single request, across every blueprint —
    # this is what makes a suspend/ban/delete take effect instantly
    # instead of only being caught the next time someone logs in.

    if "username" not in session:
        return

    username = session["username"]

    session_invalid = (
        get_user(username) is None
        or is_deleted(username)
        or is_banned(username)
        or is_suspended(username)
    )

    if not session_invalid:
        return

    session.clear()

    wants_json = any(
        request.path.startswith(prefix)
        for prefix in JSON_RESPONSE_PATH_PREFIXES
    )

    if wants_json:
        return jsonify({
            "success": False,
            "session_invalid": True,
            "message": "Your session has ended."
        }), 401

    return redirect("/login")

@app.route("/test-crash")
def test_crash():
    raise Exception("Just testing the error page")

@app.errorhandler(404)
def handle_not_found(error):

    if any(request.path.startswith(p) for p in JSON_RESPONSE_PATH_PREFIXES):
        return jsonify({
            "success": False,
            "message": "That doesn't exist."
        }), 404

    return no_cache(make_response(render_template(
        "error.html",
        code=404,
        title="Page not found",
        message="That page doesn't exist, or the link is wrong."
    ))), 404


@app.errorhandler(500)
def handle_server_error(error):

    # Flask already logs the real traceback to the server logs before
    # this runs — this only controls what the *person* sees, so a
    # crash never shows a blank page or breaks a fetch() call that's
    # expecting JSON back.

    if any(request.path.startswith(p) for p in JSON_RESPONSE_PATH_PREFIXES):
        return jsonify({
            "success": False,
            "message": "Something went wrong. Please try again."
        }), 500

    return no_cache(make_response(render_template(
        "error.html",
        code=500,
        title="Something broke",
        message="That's on us, not you. Try again in a moment."
    ))), 500


@app.route("/")
def home():

    if "username" not in session:
        return redirect("/login")

    return redirect("/chats")


@app.route("/signup", methods=["GET", "POST"])
def signup():

    if request.method == "GET":
        return no_cache(make_response(render_template("signup.html")))

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

        return no_cache(make_response(render_template("login.html")))

    username = request.form.get("username", "").strip().lower()
    password = request.form.get("password", "")
    ip = request.remote_addr

    if ip in get_banned_ips():
        return jsonify({
            "success": False,
            "field": "password",
            "message": "This device has been banned."
        })

    if is_banned(username):
        return jsonify({
            "success": False,
            "field": "password",
            "message": "This account has been banned."
        })

    if is_suspended(username):
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
