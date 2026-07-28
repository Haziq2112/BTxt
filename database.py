"""
BText database layer.

One unified set of functions — no separate "SQLite version" /
"Postgres version" of everything. Locally (Termux) it uses a
SQLite file. On Render, set the DATABASE_URL environment variable
to a Postgres connection string and it switches automatically.
Both use the same SQL here, so there's only one code path to trust.
"""

from datetime import datetime,timezone
import os
import secrets
import string
import uuid

from sqlalchemy import create_engine, text
from werkzeug.security import generate_password_hash


DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///btext.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {}

if DATABASE_URL.startswith("postgresql://"):

    # pg8000 doesn't understand query params like sslmode/channel_binding
    # (those are specific to a different driver) -- strip them from the URL.
    base_url = DATABASE_URL.split("?")[0]

    # Neon (and most hosted Postgres) require SSL. pg8000 needs this
    # requested as a connect argument rather than a URL query param.
    if "neon.tech" in base_url or "render.com" in base_url:
        connect_args = {"ssl_context": True}

    DATABASE_URL = base_url.replace("postgresql://", "postgresql+pg8000://", 1)

engine = create_engine(DATABASE_URL, connect_args=connect_args)


def get_conn():
    return engine.begin()


# ============================================================
# SETUP
# ============================================================

def init_db():

    with get_conn() as conn:

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS users(
            username TEXT PRIMARY KEY,
            password TEXT NOT NULL,
            bio TEXT DEFAULT 'No bio yet.',
            profile_picture TEXT DEFAULT '',
            btext_id TEXT UNIQUE,
            joined_date TEXT,
            phone TEXT DEFAULT ''
        )
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS deleted_users(
            username TEXT PRIMARY KEY,
            password TEXT NOT NULL,
            bio TEXT DEFAULT 'No bio yet.',
            profile_picture TEXT DEFAULT '',
            btext_id TEXT,
            joined_date TEXT,
            phone TEXT DEFAULT '',
            deleted_by TEXT DEFAULT 'admin'
        )
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS contacts(
            owner TEXT,
            contact TEXT,
            PRIMARY KEY(owner, contact)
        )
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS ip_log(
            ip TEXT,
            username TEXT,
            PRIMARY KEY(ip, username)
        )
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS user_ips(
            username TEXT PRIMARY KEY,
            ip TEXT
        )
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS banned_users(
            username TEXT PRIMARY KEY
        )
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS suspended_users(
            username TEXT PRIMARY KEY
        )
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS banned_ips(
            ip TEXT PRIMARY KEY
        )
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS messages(
            id TEXT PRIMARY KEY,
            sender TEXT NOT NULL,
            receiver TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            edited INTEGER DEFAULT 0,
            reply_text TEXT DEFAULT '',
            reply_self INTEGER DEFAULT 0,
            deleted_everyone INTEGER DEFAULT 0,
            deleted_for TEXT DEFAULT ''
        )
        """))

        # Automatically add new columns on existing databases

        try:
            conn.execute(text("""
                ALTER TABLE messages
                ADD COLUMN created_at TIMESTAMP
            """))
        except Exception:
            pass

        try:
            conn.execute(text("""
                UPDATE messages
                SET created_at = CURRENT_TIMESTAMP
                WHERE created_at IS NULL
            """))
        except Exception:
            pass

def generate_btext_id():

    letters = string.ascii_uppercase
    digits = string.digits

    while True:

        positions = list(range(6))
        first_digit = secrets.choice(positions)

        remaining = [
            p for p in positions
            if abs(p - first_digit) > 1
        ]
        second_digit = secrets.choice(remaining)

        code = []
        for i in range(6):
            if i == first_digit or i == second_digit:
                code.append(secrets.choice(digits))
            else:
                code.append(secrets.choice(letters))

        new_id = "BTX-" + "".join(code)

        if not get_user_by_btext_id(new_id):
            return new_id


# ============================================================
# USERS
# ============================================================

def get_user_by_btext_id(btext_id):

    with get_conn() as conn:

        row = conn.execute(
            text("SELECT username FROM users WHERE btext_id=:id"),
            {"id": btext_id}
        ).fetchone()

        return row


def is_deleted(username):

    with get_conn() as conn:

        row = conn.execute(
            text("""
            SELECT 1 FROM deleted_users
            WHERE LOWER(username)=LOWER(:username)
            """),
            {"username": username}
        ).fetchone()

        return row is not None


def get_user(username):

    with get_conn() as conn:

        row = conn.execute(
            text("""
            SELECT
                password, bio, profile_picture,
                btext_id, joined_date, phone
            FROM users
            WHERE username=:username
            """),
            {"username": username}
        ).fetchone()

        return row


def add_user(username, password):

    hashed = generate_password_hash(password)
    btext_id = generate_btext_id()
    joined = datetime.now().strftime("%d %B %Y")

    with get_conn() as conn:

        conn.execute(
            text("""
            INSERT INTO users
                (username, password, bio, profile_picture,
                 btext_id, joined_date, phone)
            VALUES
                (:username, :password, :bio, :picture,
                 :id, :joined, :phone)
            """),
            {
                "username": username,
                "password": hashed,
                "bio": "No bio yet.",
                "picture": "",
                "id": btext_id,
                "joined": joined,
                "phone": ""
            }
        )


def get_all_users():

    with get_conn() as conn:

        result = conn.execute(
            text("SELECT username, password FROM users ORDER BY username")
        )

        return {row.username: row.password for row in result}


def change_password(username, new_password):

    hashed = generate_password_hash(new_password)

    with get_conn() as conn:

        conn.execute(
            text("UPDATE users SET password=:password WHERE username=:username"),
            {"password": hashed, "username": username}
        )


def delete_user(username):

    with get_conn() as conn:

        conn.execute(
            text("DELETE FROM users WHERE username=:username"),
            {"username": username}
        )


def add_deleted_user(username, deleted_by="admin"):

    user = get_user(username)

    if not user:
        return False

    with get_conn() as conn:

        conn.execute(
            text("""
            INSERT INTO deleted_users
                (username, password, bio, profile_picture,
                 btext_id, joined_date, phone, deleted_by)
            VALUES
                (:username, :password, :bio, :profile_picture,
                 :btext_id, :joined_date, :phone, :deleted_by)
            """),
            {
                "username": username,
                "password": user.password,
                "bio": user.bio,
                "profile_picture": user.profile_picture,
                "btext_id": user.btext_id,
                "joined_date": user.joined_date,
                "phone": user.phone,
                "deleted_by": deleted_by
            }
        )

    return True


def get_deleted_users():

    with get_conn() as conn:

        result = conn.execute(
            text("SELECT username, deleted_by FROM deleted_users ORDER BY username")
        )

        return result.fetchall()


def restore_user(username):

    with get_conn() as conn:

        row = conn.execute(
            text("""
            SELECT username, password, bio, profile_picture,
                   btext_id, joined_date, phone
            FROM deleted_users
            WHERE username=:username
            """),
            {"username": username}
        ).fetchone()

        if not row:
            return False

        conn.execute(
            text("""
            INSERT INTO users
                (username, password, bio, profile_picture,
                 btext_id, joined_date, phone)
            VALUES
                (:username, :password, :bio, :profile_picture,
                 :btext_id, :joined_date, :phone)
            """),
            {
                "username": row.username,
                "password": row.password,
                "bio": row.bio,
                "profile_picture": row.profile_picture,
                "btext_id": row.btext_id,
                "joined_date": row.joined_date,
                "phone": row.phone
            }
        )

        conn.execute(
            text("DELETE FROM deleted_users WHERE username=:username"),
            {"username": username}
        )

    return True


def delete_user_forever(username):

    with get_conn() as conn:

        conn.execute(
            text("DELETE FROM deleted_users WHERE username=:username"),
            {"username": username}
        )


# ============================================================
# IP TRACKING
# ============================================================

def add_ip_user(ip, username):

    with get_conn() as conn:

        conn.execute(
            text("""
            INSERT INTO ip_log(ip, username)
            VALUES(:ip, :username)
            ON CONFLICT DO NOTHING
            """),
            {"ip": ip, "username": username}
        )


def remove_ip_user(ip, username):

    with get_conn() as conn:

        conn.execute(
            text("DELETE FROM ip_log WHERE ip=:ip AND username=:username"),
            {"ip": ip, "username": username}
        )


def get_ip_users(ip):

    with get_conn() as conn:

        result = conn.execute(
            text("SELECT username FROM ip_log WHERE ip=:ip"),
            {"ip": ip}
        )

        return [row.username for row in result]


def set_user_ip(username, ip):

    with get_conn() as conn:

        conn.execute(
            text("""
            INSERT INTO user_ips(username, ip)
            VALUES(:username, :ip)
            ON CONFLICT(username) DO UPDATE SET ip=excluded.ip
            """),
            {"username": username, "ip": ip}
        )


def get_user_ip(username):

    with get_conn() as conn:

        row = conn.execute(
            text("SELECT ip FROM user_ips WHERE username=:username"),
            {"username": username}
        ).fetchone()

        return row.ip if row else None


# ============================================================
# CONTACTS
# ============================================================

def add_contact(owner, contact):

    with get_conn() as conn:

        conn.execute(
            text("""
            INSERT INTO contacts(owner, contact)
            VALUES(:owner, :contact)
            ON CONFLICT DO NOTHING
            """),
            {"owner": owner, "contact": contact}
        )


def get_contacts(owner):

    with get_conn() as conn:

        result = conn.execute(
            text("SELECT contact FROM contacts WHERE owner=:owner"),
            {"owner": owner}
        )

        return [row.contact for row in result]


def remove_contact(owner, contact):

    with get_conn() as conn:

        conn.execute(
            text("DELETE FROM contacts WHERE owner=:owner AND contact=:contact"),
            {"owner": owner, "contact": contact}
        )


# ============================================================
# MODERATION
# ============================================================

def ban_user(username):

    with get_conn() as conn:

        conn.execute(
            text("""
            INSERT INTO banned_users(username)
            VALUES(:username)
            ON CONFLICT DO NOTHING
            """),
            {"username": username}
        )


def unban_user(username):

    with get_conn() as conn:

        conn.execute(
            text("DELETE FROM banned_users WHERE username=:username"),
            {"username": username}
        )


def get_banned_users():

    with get_conn() as conn:

        result = conn.execute(text("SELECT username FROM banned_users"))
        return [row.username for row in result]


def suspend_user(username):

    with get_conn() as conn:

        conn.execute(
            text("""
            INSERT INTO suspended_users(username)
            VALUES(:username)
            ON CONFLICT DO NOTHING
            """),
            {"username": username}
        )


def resume_user(username):

    with get_conn() as conn:

        conn.execute(
            text("DELETE FROM suspended_users WHERE username=:username"),
            {"username": username}
        )


def get_suspended_users():

    with get_conn() as conn:

        result = conn.execute(text("SELECT username FROM suspended_users"))
        return [row.username for row in result]


def ban_ip(ip):

    with get_conn() as conn:

        conn.execute(
            text("""
            INSERT INTO banned_ips(ip)
            VALUES(:ip)
            ON CONFLICT DO NOTHING
            """),
            {"ip": ip}
        )


def unban_ip(ip):

    with get_conn() as conn:

        conn.execute(
            text("DELETE FROM banned_ips WHERE ip=:ip"),
            {"ip": ip}
        )


def get_banned_ips():

    with get_conn() as conn:

        result = conn.execute(text("SELECT ip FROM banned_ips"))
        return [row.ip for row in result]


# ============================================================
# MESSAGES
# ============================================================

def save_message(sender, receiver, message, timestamp, reply_text="", reply_self=False):

    message_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:

        conn.execute(
            text("""
            INSERT INTO messages
                (id, sender, receiver, message, timestamp, created_at, edited,
                reply_text, reply_self, deleted_everyone, deleted_for)
            VALUES
            (:id, :sender, :receiver, :message, :timestamp, :created_at, 0,
                :reply_text, :reply_self, 0, '')
            """),
            {
                "id": message_id,
                "sender": sender,
                "receiver": receiver,
                "message": message,
                "timestamp": timestamp,
                "created_at": created_at,
                "reply_text": reply_text,
                "reply_self": 1 if reply_self else 0
            }
        )

    return message_id


def get_messages(user1, user2):

    with get_conn() as conn:

        result = conn.execute(
            text("""
            SELECT id, sender, receiver, message, timestamp, edited,
                   reply_text, reply_self, deleted_everyone, deleted_for
            FROM messages
            WHERE (sender=:u1 AND receiver=:u2)
               OR (sender=:u2 AND receiver=:u1)
            ORDER BY
            CASE
                WHEN created_at IS NULL OR created_at = ''
                THEN timestamp
                ELSE created_at
            END ASC
            """),
            {"u1": user1, "u2": user2}
        )

        return result.fetchall()


def edit_message(message_id, username, new_text):

    with get_conn() as conn:

        result = conn.execute(
            text("""
            UPDATE messages
            SET message=:message, edited=1
            WHERE id=:id AND sender=:sender AND deleted_everyone=0
            """),
            {"message": new_text, "id": message_id, "sender": username}
        )

        return result.rowcount > 0


def delete_message_everyone(message_id, username):

    with get_conn() as conn:

        result = conn.execute(
            text("""
            UPDATE messages
            SET deleted_everyone=1
            WHERE id=:id AND sender=:sender
            """),
            {"id": message_id, "sender": username}
        )

        return result.rowcount > 0


def delete_message_for_me(message_id, username):

    with get_conn() as conn:

        row = conn.execute(
            text("SELECT deleted_for FROM messages WHERE id=:id"),
            {"id": message_id}
        ).fetchone()

        if not row:
            return False

        users = [u for u in (row.deleted_for or "").split(",") if u]

        if username not in users:
            users.append(username)

        conn.execute(
            text("UPDATE messages SET deleted_for=:deleted_for WHERE id=:id"),
            {"deleted_for": ",".join(users), "id": message_id}
        )

        return True


def get_last_message(user1, user2):

    messages = get_messages(user1, user2)

    if not messages:
        return "No messages yet"

    return messages[-1].message


# ============================================================
# PROFILE
# ============================================================

def get_profile(username):

    with get_conn() as conn:

        row = conn.execute(
            text("""
            SELECT username, bio, profile_picture,
                   btext_id, joined_date, phone
            FROM users
            WHERE username=:username
            """),
            {"username": username}
        ).fetchone()

        return row


def get_profile_picture(username):

    with get_conn() as conn:

        row = conn.execute(
            text("SELECT profile_picture FROM users WHERE username=:username"),
            {"username": username}
        ).fetchone()

        return row.profile_picture if row else None

def update_profile(old_username, new_username, bio):

    with get_conn() as conn:

        conn.execute(
            text("""
                UPDATE users
                SET username=:new_username,
                    bio=:bio
                WHERE username=:old_username
            """),
            {
                "new_username": new_username,
                "bio": bio,
                "old_username": old_username
            }
        )

        conn.execute(
            text("""
                UPDATE contacts
                SET owner=:new_username
                WHERE owner=:old_username
            """),
            {
                "new_username": new_username,
                "old_username": old_username
            }
        )

        conn.execute(
            text("""
                UPDATE contacts
                SET contact=:new_username
                WHERE contact=:old_username
            """),
            {
                "new_username": new_username,
                "old_username": old_username
            }
        )

        conn.execute(
            text("""
                UPDATE user_ips
                SET username=:new_username
                WHERE username=:old_username
            """),
            {
                "new_username": new_username,
                "old_username": old_username
            }
        )

def update_profile_picture(username, picture_data_url):

    # picture_data_url is a full data: URL (e.g. "data:image/png;base64,....")
    # stored directly in the database — no filesystem involved, so it
    # survives Render restarts as long as Postgres is connected.

    with get_conn() as conn:

        conn.execute(
            text("""
            UPDATE users
            SET profile_picture=:picture
            WHERE username=:username
            """),
            {"picture": picture_data_url, "username": username}
        )


def remove_profile_picture(username):

    with get_conn() as conn:

        conn.execute(
            text("UPDATE users SET profile_picture='' WHERE username=:username"),
            {"username": username}
        )


def get_all_profiles():

    with get_conn() as conn:

        result = conn.execute(
            text("""
            SELECT username, bio, profile_picture,
                   btext_id, joined_date, phone
            FROM users
            ORDER BY username
            """)
        )

        return result.fetchall()

def username_exists(username):

    with get_conn() as conn:

        result = conn.execute(
            text("""
                SELECT username
                FROM users
                WHERE LOWER(username)=LOWER(:username)
            """),
            {
                "username": username
            }
        )

        return result.first() is not None
