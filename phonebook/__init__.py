import os

from flask import Flask

from .config import DEFAULT_DB
from .db import close_db, init_db
from .routes import register_routes


# Tạo ứng dụng Flask và đăng ký các route cho auth flow.
def create_app(test_config=None):
    app = Flask(
        __name__,
        template_folder=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates"),
    )
    app.secret_key = "dev-secret-key"  # Khóa bí mật cho session.
    app.config.from_mapping(
        DATABASE=test_config.get("DATABASE") if test_config else DEFAULT_DB,
        TESTING=test_config.get("TESTING", False) if test_config else False,
    )

    app.teardown_appcontext(close_db)  # Đóng DB sau mỗi request.
    register_routes(app)  # Gắn các route vào app.

    return app


__all__ = ["create_app", "init_db"]
