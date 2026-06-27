import sqlite3

import bcrypt
from flask import current_app, g

from .config import DEFAULT_DB


# Tạo bảng users nếu chưa tồn tại trong database và thêm cột còn thiếu cho schema cũ.
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

    conn.commit()
    conn.close()


# Lấy kết nối database cho mỗi request.
def get_db():
    if "db" not in g:
        conn = sqlite3.connect(current_app.config["DATABASE"])
        conn.row_factory = sqlite3.Row
        g.db = conn
    return g.db


# Đóng kết nối sau khi request kết thúc.
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.commit()
        db.close()
