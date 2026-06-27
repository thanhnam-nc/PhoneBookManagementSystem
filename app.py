from phonebook import create_app, init_db

# Khởi tạo app Flask và bảng database khi chạy file này.
app = create_app()
init_db()


if __name__ == "__main__":
    app.run(debug=True)  # Chạy server ở chế độ debug cho local development.
