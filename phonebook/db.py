import sqlite3

import bcrypt
from flask import current_app, g

from .config import DEFAULT_DB


def init_db(db_path=None):
    database_path = db_path or current_app.config.get("DATABASE", DEFAULT_DB) if current_app else DEFAULT_DB
    conn = sqlite3.connect(database_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            phone_number TEXT,
            password_hash TEXT NOT NULL,
            security_question TEXT,
            security_answer_hash TEXT
        )
        """
    )

    existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
    if "role" not in existing_columns:
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
    if "created_at" not in existing_columns:
        conn.execute("ALTER TABLE users ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP")
    if "last_login" not in existing_columns:
        conn.execute("ALTER TABLE users ADD COLUMN last_login TEXT")
    if "locked" not in existing_columns:
        conn.execute("ALTER TABLE users ADD COLUMN locked INTEGER DEFAULT 0")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS activity_log (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            detail TEXT NOT NULL,
            level TEXT NOT NULL,
            icon TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    duplicate_phone_numbers = conn.execute(
        """
        SELECT phone_number
        FROM users
        WHERE phone_number IS NOT NULL AND phone_number != ''
        GROUP BY phone_number
        HAVING COUNT(*) > 1
        """
    ).fetchall()
    for (phone_number,) in duplicate_phone_numbers:
        keep_user = conn.execute(
            "SELECT user_id FROM users WHERE phone_number = ? ORDER BY user_id",
            (phone_number,),
        ).fetchone()
        if keep_user:
            conn.execute(
                "UPDATE users SET phone_number = NULL WHERE phone_number = ? AND user_id != ?",
                (phone_number, keep_user[0]),
            )

    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_number_unique
        ON users(phone_number)
        WHERE phone_number IS NOT NULL AND phone_number != ''
        """
    )

    admin_email = "admin@phonebook.com"
    admin_exists = conn.execute("SELECT 1 FROM users WHERE email = ?", (admin_email,)).fetchone()
    if not admin_exists:
        password_hash = bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode("utf-8")
        conn.execute(
            """
            INSERT INTO users (email, phone_number, password_hash, security_question, security_answer_hash, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (admin_email, "0000000000", password_hash, "What is the admin password?", bcrypt.hashpw(b"admin", bcrypt.gensalt()).decode("utf-8"), "admin", "2026-06-25 00:00:00"),
        )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS contacts (
            contact_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            address TEXT,
            category TEXT,
            favorite INTEGER DEFAULT 0,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS categories (
            category_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
        """
    )

    existing_columns_contacts = {row[1] for row in conn.execute("PRAGMA table_info(contacts)")}
    if "notes" not in existing_columns_contacts:
        conn.execute("ALTER TABLE contacts ADD COLUMN notes TEXT")

    conn.commit()
    conn.close()


def get_db():
    if "db" not in g:
        conn = sqlite3.connect(current_app.config["DATABASE"])
        conn.row_factory = sqlite3.Row
        g.db = conn
    return g.db


def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.commit()
        db.close()