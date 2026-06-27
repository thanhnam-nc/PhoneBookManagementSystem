import os

# Đường dẫn gốc của project.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# File database SQLite mặc định dùng cho app.
DEFAULT_DB = os.path.join(BASE_DIR, "phonebook.db")
