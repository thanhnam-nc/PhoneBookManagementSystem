from datetime import datetime
from functools import wraps

import bcrypt
from flask import redirect, render_template, request, session, url_for, jsonify

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
            if session.get("role") == "admin":
                return redirect(url_for("admin_dashboard"))
            else:
                return redirect(url_for("list_contacts"))
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
            existing_email = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
            existing_phone = None
            if phone_number:
                existing_phone = conn.execute("SELECT 1 FROM users WHERE phone_number = ?", (phone_number,)).fetchone()

            if existing_email or existing_phone:
                if existing_email and existing_phone:
                    message = "Email and phone number already exist."
                elif existing_email:
                    message = "Email already exists."
                else:
                    message = "Phone number already exists."
                return render_page("auth/register.html", "Register", message, True)

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
                # Phân biệt role sau đăng nhập
                if user["role"] == "admin":
                    return redirect(url_for("admin_dashboard"))
                else:
                    return redirect(url_for("list_contacts"))
            # Nếu không đúng, trả về lỗi
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

    @app.route("/verify-security-info", methods=["POST"])
    def verify_security_info():
        data = request.get_json(silent=True) or {}
        email = data.get("email", "").strip().lower()
        security_question = data.get("security_question", "").strip()
        security_answer = data.get("security_answer", "").strip().lower()

        if not email or not security_question or not security_answer:
            return {"valid": False, "message": "Please provide email, security question, and answer."}

        conn = get_db()
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not user:
            return {"valid": False, "message": "No account found for that email."}
        if security_question != user["security_question"]:
            return {"valid": False, "message": "Security question does not match."}
        if not verify_password(security_answer, user["security_answer_hash"]):
            return {"valid": False, "message": "Security answer is incorrect."}

        return {"valid": True}

    # Chuyển hướng sang dashboard phù hợp theo vai trò.
    @app.route("/dashboard")
    @login_required
    def dashboard():
        if session.get("role") == "admin":
            return redirect(url_for("admin_dashboard"))
        return redirect(url_for("list_contacts"))
    @app.route("/user-dashboard")
    @login_required
    def user_dashboard():
        return redirect(url_for("list_contacts"))

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

    # ========== PHẦN 2: QUẢN LÝ CONTACTS ==========
    @app.route("/contacts")
    @login_required
    def list_contacts():
        user_id = session["user_id"]
        db = get_db()
        contacts = db.execute(
            "SELECT * FROM contacts WHERE user_id = ? AND deleted_at IS NULL ORDER BY name",
            (user_id,)
        ).fetchall()
        contacts_list = [dict(row) for row in contacts]
        # Lấy email user để hiển thị trên sidebar
        user = db.execute("SELECT email FROM users WHERE user_id = ?", (user_id,)).fetchone()
        user_email = user["email"] if user else "User"
        return render_template("contacts/dashboard.html", contacts=contacts_list, user_email=user_email)

    @app.route("/contacts/create", methods=["POST"])
    @login_required
    def create_contact():
        user_id = session["user_id"]
        name = request.form.get("name", "").strip()
        phone = request.form.get("phone", "").strip()
        email = request.form.get("email", "").strip()
        address = request.form.get("address", "").strip()
        category = request.form.get("category", "").strip()
        favorite = 1 if request.form.get("favorite") == "1" else 0
        notes = request.form.get("notes", "").strip()

        # Validate cơ bản
        if not name:
            return jsonify({"success": False, "message": "Name is required"}), 400
        if not phone or not (9 <= len(phone) <= 11):
            return jsonify({"success": False, "message": "Phone must be 9-11 digits"}), 400

        db = get_db()

        # Kiểm tra trùng email (nếu có nhập email)
        if email:
            existing_email = db.execute(
                "SELECT 1 FROM contacts WHERE user_id = ? AND email = ? AND deleted_at IS NULL",
                (user_id, email)
            ).fetchone()
            if existing_email:
                return jsonify({"success": False, "message": "Email already exists"}), 400

        # Kiểm tra trùng số điện thoại (luôn kiểm tra vì phone đã có)
        existing_phone = db.execute(
            "SELECT 1 FROM contacts WHERE user_id = ? AND phone = ? AND deleted_at IS NULL",
            (user_id, phone)
        ).fetchone()
        if existing_phone:
            return jsonify({"success": False, "message": "Phone number already exists"}), 400

        # Thêm mới
        db.execute(
            """
            INSERT INTO contacts (user_id, name, phone, email, address, category, favorite, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, name, phone, email, address, category, favorite, notes)
        )
        db.commit()
        return jsonify({"success": True, "message": "Contact added"})

    @app.route("/contacts/search")
    @login_required
    def search_contacts():
        user_id = session["user_id"]
        q = request.args.get("q", "").strip()
        status = request.args.get("status", "active").strip()
        
        status_cond = "deleted_at IS NOT NULL" if status == "trash" else "deleted_at IS NULL"
        db = get_db()
        if q:
            query = f"""
                SELECT * FROM contacts
                WHERE user_id = ? AND {status_cond}
                AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)
                ORDER BY name
            """
            like = f"%{q}%"
            rows = db.execute(query, (user_id, like, like, like)).fetchall()
        else:
            rows = db.execute(
                f"SELECT * FROM contacts WHERE user_id = ? AND {status_cond} ORDER BY name",
                (user_id,)
            ).fetchall()
        contacts = [dict(row) for row in rows]
        return jsonify(contacts)

    @app.route("/contacts/<int:contact_id>/delete", methods=["DELETE"])
    @login_required
    def delete_contact(contact_id):
        user_id = session["user_id"]
        db = get_db()
        # Kiểm tra contact có tồn tại và thuộc về user không
        contact = db.execute(
            "SELECT * FROM contacts WHERE contact_id = ? AND user_id = ? AND deleted_at IS NULL",
            (contact_id, user_id)
        ).fetchone()
        if not contact:
            return jsonify({"error": "Contact not found"}), 404
        # Soft delete: cập nhật deleted_at
        db.execute(
            "UPDATE contacts SET deleted_at = CURRENT_TIMESTAMP WHERE contact_id = ?",
            (contact_id,)
        )
        db.commit()
        return jsonify({"success": True})

    @app.route("/contacts/<int:contact_id>/restore", methods=["POST"])
    @login_required
    def restore_contact(contact_id):
        user_id = session["user_id"]
        db = get_db()
        contact = db.execute(
            "SELECT * FROM contacts WHERE contact_id = ? AND user_id = ? AND deleted_at IS NOT NULL",
            (contact_id, user_id)
        ).fetchone()
        if not contact:
            return jsonify({"error": "Contact not found in trash"}), 404
        
        db.execute(
            "UPDATE contacts SET deleted_at = NULL WHERE contact_id = ?",
            (contact_id,)
        )
        db.commit()
        return jsonify({"success": True})

    @app.route("/contacts/<int:contact_id>/force-delete", methods=["DELETE"])
    @login_required
    def force_delete_contact(contact_id):
        user_id = session["user_id"]
        db = get_db()
        contact = db.execute(
            "SELECT * FROM contacts WHERE contact_id = ? AND user_id = ? AND deleted_at IS NOT NULL",
            (contact_id, user_id)
        ).fetchone()
        if not contact:
            return jsonify({"error": "Contact not found in trash"}), 404
            
        db.execute("DELETE FROM contacts WHERE contact_id = ?", (contact_id,))
        db.commit()
        return jsonify({"success": True})
    @app.route("/contacts/<int:contact_id>/update", methods=["POST"])
    @login_required
    def update_contact(contact_id):
        user_id = session["user_id"]
        data = request.get_json() or {}
        db = get_db()
        contact = db.execute(
            "SELECT * FROM contacts WHERE contact_id = ? AND user_id = ? AND deleted_at IS NULL",
            (contact_id, user_id)
        ).fetchone()
        if not contact:
            return jsonify({"error": "Contact not found"}), 404

        # Validate name
        if "name" in data:
            name = data["name"].strip()
            if not name:
                return jsonify({"success": False, "error": "Name is required"}), 400
        else:
            name = contact["name"]

        # Validate phone
        if "phone" in data:
            phone = data["phone"].strip()
            if not phone or not (9 <= len(phone) <= 11):
                return jsonify({"success": False, "error": "Phone must be 9-11 digits"}), 400
            
            # Check duplicate phone for this user (excluding current contact)
            existing_phone = db.execute(
                "SELECT 1 FROM contacts WHERE user_id = ? AND phone = ? AND contact_id != ? AND deleted_at IS NULL",
                (user_id, phone, contact_id)
            ).fetchone()
            if existing_phone:
                return jsonify({"success": False, "error": "Phone number already exists"}), 400
        else:
            phone = contact["phone"]

        # Validate email
        if "email" in data:
            email = data["email"].strip()
            if email:
                import re
                if not re.match(r"^[^@]+@[^@]+\.[^@]+$", email):
                    return jsonify({"success": False, "error": "Enter a valid email"}), 400
                
                # Check duplicate email for this user (excluding current contact)
                existing_email = db.execute(
                    "SELECT 1 FROM contacts WHERE user_id = ? AND email = ? AND contact_id != ? AND deleted_at IS NULL",
                    (user_id, email, contact_id)
                ).fetchone()
                if existing_email:
                    return jsonify({"success": False, "error": "Email already exists"}), 400
        else:
            email = contact["email"]

        address = data.get("address", contact["address"])
        if address is not None:
            address = address.strip()

        category = data.get("category", contact["category"])
        favorite = int(data.get("favorite", contact["favorite"]))
        
        notes = data.get("notes", contact["notes"])
        if notes is not None:
            notes = notes.strip()

        db.execute(
            """
            UPDATE contacts
            SET name = ?, phone = ?, email = ?, address = ?, category = ?, favorite = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE contact_id = ?
            """,
            (name, phone, email, address, category, favorite, notes, contact_id)
        )
        db.commit()
        return jsonify({"success": True})
    @app.route("/api/categories", methods=["GET"])
    @login_required
    def get_categories():
        user_id = session["user_id"]
        db = get_db()
        rows = db.execute(
            "SELECT * FROM categories WHERE user_id = ? ORDER BY name",
            (user_id,)
        ).fetchall()
        return jsonify([dict(r) for r in rows])

    @app.route("/api/categories", methods=["POST"])
    @login_required
    def create_category():
        user_id = session["user_id"]
        data = request.get_json()
        name = data.get("name", "").strip()
        if not name:
            return jsonify({"success": False, "error": "Name is required."})
        db = get_db()
        existing = db.execute(
            "SELECT 1 FROM categories WHERE user_id = ? AND name = ?",
            (user_id, name)
        ).fetchone()
        if existing:
            return jsonify({"success": False, "error": "Already exists."})
        db.execute(
            "INSERT INTO categories (user_id, name) VALUES (?, ?)",
            (user_id, name)
        )
        db.commit()
        return jsonify({"success": True})

    @app.route("/api/categories/<int:cat_id>", methods=["DELETE"])
    @login_required
    def delete_category(cat_id):
        user_id = session["user_id"]
        db = get_db()
        db.execute(
            "DELETE FROM categories WHERE category_id = ? AND user_id = ?",
            (cat_id, user_id)
        )
        db.commit()
        return jsonify({"success": True})