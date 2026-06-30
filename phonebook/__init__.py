import os
from flask import Flask
from .config import DEFAULT_DB
from .db import close_db, init_db
from .routes import register_routes

def create_app(test_config=None):
    # Lấy đường dẫn tuyệt đối đến thư mục gốc của project (chứa app.py)
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    app = Flask(
        __name__,
        template_folder=os.path.join(project_root, "templates"),
        static_folder=os.path.join(project_root, "static"),
        static_url_path="/static"
    )
    app.secret_key = "dev-secret-key"
    app.config.from_mapping(
        DATABASE=test_config.get("DATABASE") if test_config else DEFAULT_DB,
        TESTING=test_config.get("TESTING", False) if test_config else False,
    )
    app.teardown_appcontext(close_db)
    register_routes(app)
    return app

__all__ = ["create_app", "init_db"]