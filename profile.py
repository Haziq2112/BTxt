import base64

from flask import Blueprint, render_template, request, redirect, session, flash, jsonify
from werkzeug.security import check_password_hash

from database import (
    get_profile, update_profile, update_profile_picture,
    get_user, change_password, remove_profile_picture,
    add_deleted_user, delete_user,
    username_exists
)

profile_bp = Blueprint("profile", __name__)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
MAX_PICTURE_BYTES = 2 * 1024 * 1024  # 2 MB, keeps DB rows small

MIME_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp"
}


def logged_in():
    return "username" in session


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


@profile_bp.route("/profile")
def profile():

    if not logged_in():
        return redirect("/login")

    data = get_profile(session["username"])

    return render_template(
        "profile.html",
        username=data.username,
        bio=data.bio,
        profile_picture=data.profile_picture,
        btext_id=data.btext_id,
        joined_date=data.joined_date,
        phone=data.phone
    )


@profile_bp.route("/profile/update", methods=["POST"])
def update_profile_route():

    if not logged_in():
        return redirect("/login")

    username = session["username"]
    new_username = request.form.get("username", "").strip().lower()

    if not new_username:
        flash("Username cannot be empty")
        return redirect("/profile")

    if new_username != username and username_exists(new_username):
        flash("Username already exists.")
        return redirect("/profile")

    bio = request.form.get("bio", "").strip()

    update_profile(username, new_username, bio)

    session["username"] = new_username

    flash("Profile updated successfully")

    return redirect("/profile")


@profile_bp.route("/profile/picture", methods=["POST"])
def update_picture():

    if not logged_in():
        return redirect("/login")

    username = session["username"]

    if "picture" not in request.files:
        flash("No picture selected.")
        return redirect("/profile")

    file = request.files["picture"]

    if file.filename == "":
        flash("No picture selected.")
        return redirect("/profile")

    if not allowed_file(file.filename):
        flash("Only PNG, JPG, JPEG and WEBP are allowed.")
        return redirect("/profile")

    file_bytes = file.read()

    if len(file_bytes) > MAX_PICTURE_BYTES:
        flash("Picture must be under 2MB.")
        return redirect("/profile")

    extension = file.filename.rsplit(".", 1)[1].lower()
    mime_type = MIME_TYPES[extension]

    # Stored directly as a data: URL inside the database row — no file
    # ever touches disk, so it survives restarts/redeploys as long as
    # the database itself is persistent (e.g. Postgres on Render).
    encoded = base64.b64encode(file_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{encoded}"

    update_profile_picture(username, data_url)

    flash("Profile picture updated.")

    return redirect("/profile")


@profile_bp.route("/profile/remove_picture")
def remove_picture():

    if not logged_in():
        return redirect("/login")

    remove_profile_picture(session["username"])

    flash("Profile picture removed.")

    return redirect("/profile")


@profile_bp.route("/settings")
def settings():

    if not logged_in():
        return redirect("/login")

    data = get_profile(session["username"])

    return render_template(
        "settings.html",
        username=data.username,
        bio=data.bio,
        profile_picture=data.profile_picture
    )


@profile_bp.route("/privacy")
def privacy():

    if not logged_in():
        return redirect("/login")

    return render_template("privacy.html", username=session["username"])


@profile_bp.route("/chat_settings")
def chat_settings():

    if not logged_in():
        return redirect("/login")

    return render_template("chat_settings.html", username=session["username"])


@profile_bp.route("/appearance")
def appearance():

    if not logged_in():
        return redirect("/login")

    return render_template("appearance.html", username=session["username"])


@profile_bp.route("/about")
def about():

    if not logged_in():
        return redirect("/login")

    return render_template("about.html", username=session["username"])


@profile_bp.route("/change_password", methods=["GET", "POST"])
def change_password_page():

    if not logged_in():
        return redirect("/login")

    if request.method == "POST":

        current = request.form.get("current_password", "")
        new = request.form.get("new_password", "")
        confirm = request.form.get("confirm_password", "")

        user = get_user(session["username"])

        if not check_password_hash(user.password, current):
            flash("Current password is incorrect.")
            return redirect("/profile")

        if new != confirm:
            flash("New passwords do not match.")
            return redirect("/profile")

        if len(new) < 8:
            flash("Password must be at least 8 characters.")
            return redirect("/profile")

        if current == new:
            flash("New password cannot be the same as the current password.")
            return redirect("/profile")

        change_password(session["username"], new)

        flash("Password changed successfully.")

        return redirect("/profile")

    return render_template("change_password.html", username=session["username"])


@profile_bp.route("/profile/delete_account", methods=["POST"])
def delete_own_account():

    if not logged_in():
        return redirect("/login")

    username = session["username"]

    add_deleted_user(username, deleted_by="user")
    delete_user(username)

    session.clear()

    flash("Your account has been deleted.")

    return redirect("/login")


@profile_bp.route("/profile/check_username")
def check_username():

    if not logged_in():
        return jsonify({"available": False})

    username = request.args.get("username", "").strip().lower()
    current = session["username"].lower()

    if username == current:
        return jsonify({"available": True})

    available = not username_exists(username)

    return jsonify({"available": available})
