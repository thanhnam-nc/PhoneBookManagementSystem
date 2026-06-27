from datetime import datetime
from functools import wraps

import bcrypt
from flask import redirect, render_template, request, session, url_for

from .db import get_db


# Mã hóa mật khẩu trước khi lưu vào database.
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# Kiểm tra mật khẩu nhập vào có đúng với hash đã lưu không.
def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def register_routes(app):
    # Chặn truy cập nếu chưa đăng nhập.
    def login_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if "user_id" not in session:
                return redirect(url_for("login"))
            return view(*args, **kwargs)

        return wrapped

    # Render template chung cho các trang auth.
    def render_page(template_name, title, message=None, error=False):
        return render_template(template_name, title=title, message=message, error=error)

    @app.route("/")
    def index():
        if "user_id" in session:
            return redirect(url_for("dashboard"))
        return redirect(url_for("login"))

    # Đăng ký tài khoản mới.
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            phone_number = request.form.get("phone_number", "").strip()
            password = request.form.get("password", "")
            confirm_password = request.form.get("confirm_password", "")
            security_question = request.form.get("security_question", "").strip()
            security_answer = request.form.get("security_answer", "").strip()

            if not email or not password or password != confirm_password:
                return render_page(
                    "auth/register.html",
                    "Register",
                    "Please provide a valid email and matching passwords.",
                    True,
                )

            conn = get_db()
            existing = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
            if existing:
                return render_page("auth/register.html", "Register", "Email already exists.", True)

            password_hash = hash_password(password)
            answer_hash = hash_password(security_answer.lower())
            conn.execute(
                "INSERT INTO users (email, phone_number, password_hash, security_question, security_answer_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    email,
                    phone_number,
                    password_hash,
                    security_question,
                    answer_hash,
                    "user",
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                ),
            )
            conn.commit()
            return redirect(url_for("login", message="Registration successful. Please log in.", error=False))

        return render_page("auth/register.html", "Register", None, False)

    # Đăng nhập và tạo session cho user.
    @app.route("/login", methods=["GET", "POST"])
    def login():
        message = request.args.get("message")
        error = request.args.get("error", "false").lower() in {"1", "true", "yes"}

        if request.method == "POST":
            identifier = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            conn = get_db()
            user = conn.execute(
                "SELECT * FROM users WHERE email = ? OR phone_number = ?",
                (identifier, identifier),
            ).fetchone()
            if user and verify_password(password, user["password_hash"]):
                session["user_id"] = user["user_id"]
                session["role"] = user["role"]
                conn.execute(
                    "UPDATE users SET last_login = ? WHERE user_id = ?",
                    (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), user["user_id"]),
                )
                conn.commit()
                if user["role"] == "admin":
                    return redirect(url_for("admin_dashboard"))
                return redirect(url_for("user_dashboard"))
            return render_page("auth/login.html", "Login", "Invalid email/phone or password.", True)

        return render_page("auth/login.html", "Login", message, error)

    # Reset mật khẩu theo 3 bước: email -> câu hỏi bảo mật -> mật khẩu mới.
    @app.route("/reset-password", methods=["GET", "POST"])
    def reset_password():
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            security_question = request.form.get("security_question", "").strip()
            security_answer = request.form.get("security_answer", "").strip().lower()
            new_password = request.form.get("new_password", "")
            confirm_password = request.form.get("confirm_password", "")

            if not email or not new_password or new_password != confirm_password:
                return render_page(
                    "auth/reset_password.html",
                    "Reset Password",
                    "Please provide matching passwords.",
                    True,
                )

            conn = get_db()
            user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if not user:
                return render_page("auth/reset_password.html", "Reset Password", "No account found for that email.", True)
            if security_question != user["security_question"]:
                return render_page("auth/reset_password.html", "Reset Password", "Security question does not match.", True)
            if not verify_password(security_answer, user["security_answer_hash"]):
                return render_page("auth/reset_password.html", "Reset Password", "Security answer is incorrect.", True)

            conn.execute(
                "UPDATE users SET password_hash = ? WHERE user_id = ?",
                (hash_password(new_password), user["user_id"]),
            )
            conn.commit()
            session.clear()
            return redirect(url_for("login", message="Password reset successful. Please log in again.", error=False))

        return render_page("auth/reset_password.html", "Reset Password", None, False)

    # Chuyển hướng sang dashboard phù hợp theo vai trò.
    @app.route("/dashboard")
    @login_required
    def dashboard():
        if session.get("role") == "admin":
            return redirect(url_for("admin_dashboard"))
        return redirect(url_for("user_dashboard"))

    # Trang dashboard dành cho user thường.
    @app.route("/user-dashboard")
    @login_required
    def user_dashboard():
        return render_template("auth/dashboard.html", title="User Dashboard", message=None, error=False, page_title="User Dashboard")

    # Trang dashboard dành cho admin.
    @app.route("/admin-dashboard")
    @login_required
    def admin_dashboard():
        return render_template("auth/dashboard.html", title="Admin Dashboard", message=None, error=False, page_title="Admin Dashboard")

    # Đăng xuất và xóa session.
    @app.route("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))
