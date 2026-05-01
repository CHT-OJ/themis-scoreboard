from __future__ import annotations

import os
import shutil
from datetime import datetime
from pathlib import Path

from flask import Flask, abort, flash, jsonify, redirect, render_template, request, session, url_for
from werkzeug.utils import secure_filename

from db import connect_db, fetch_contestant_detail, fetch_scoreboard, init_db, replace_active_snapshot
from themis_parser import WorkbookValidationError, build_contest_payload, parse_workbook


try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv()


def create_app() -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-key")
    app.config["ADMIN_PASSWORD"] = os.getenv("ADMIN_PASSWORD", "admin123")
    app.config["UPLOAD_DIR"] = Path(os.getenv("UPLOAD_DIR", "uploads"))
    init_db()

    @app.get("/")
    def index():
        with connect_db() as conn:
            scoreboard = fetch_scoreboard(conn)
        return render_template("scoreboard.html", initial_scoreboard=scoreboard)

    @app.get("/contestants/<int:contestant_id>")
    def contestant_page(contestant_id: int):
        with connect_db() as conn:
            detail = fetch_contestant_detail(conn, contestant_id)
            scoreboard = fetch_scoreboard(conn)
        if detail is None:
            abort(404)
        snapshot = scoreboard["snapshot"] if scoreboard else None
        return render_template("detail.html", detail=detail, snapshot=snapshot)

    @app.get("/api/scoreboard")
    def api_scoreboard():
        with connect_db() as conn:
            scoreboard = fetch_scoreboard(conn)
        if scoreboard is None:
            return jsonify({"snapshot": None, "problems": [], "stats": {}, "contestants": []})
        return jsonify(scoreboard)

    @app.get("/api/contestants/<int:contestant_id>")
    def api_contestant(contestant_id: int):
        with connect_db() as conn:
            detail = fetch_contestant_detail(conn, contestant_id)
        if detail is None:
            abort(404)
        return jsonify(detail)

    @app.route("/admin", methods=["GET", "POST"])
    def admin():
        if request.method == "POST":
            password = request.form.get("password", "")
            if password == app.config["ADMIN_PASSWORD"]:
                session["is_admin"] = True
                return redirect(url_for("admin"))
            flash("Mật khẩu admin không đúng.", "error")
        return render_template("admin.html", is_admin=session.get("is_admin", False))

    @app.post("/admin/upload")
    def admin_upload():
        require_admin()
        files = [file for file in request.files.getlist("files") if file and file.filename]
        if not files:
            flash("Chọn ít nhất một file Excel để phân tích.", "error")
            return redirect(url_for("admin"))

        upload_root = app.config["UPLOAD_DIR"]
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        batch_dir = upload_root / timestamp
        batch_dir.mkdir(parents=True, exist_ok=True)

        stored_files = []
        parsed_workbooks = []
        try:
            for index, file in enumerate(files):
                room = f"Phòng {index + 1}" if len(files) > 1 else "Phòng thi"
                original_name = file.filename or f"scoreboard-{index + 1}.xlsx"
                safe_name = secure_filename(original_name) or f"scoreboard-{index + 1}.xlsx"
                stored_path = batch_dir / f"{index + 1}-{safe_name}"
                file.save(stored_path)
                stored_files.append(
                    {
                        "room": room,
                        "original_name": original_name,
                        "stored_path": str(stored_path),
                    }
                )
                parsed_workbooks.append(parse_workbook(stored_path, room))

            problems, stats, contestants = build_contest_payload(parsed_workbooks)
            title = request.form.get("title") or "Final Contest"
            with connect_db() as conn:
                replace_active_snapshot(
                    conn,
                    title=title,
                    problems=problems,
                    stats=stats,
                    contestants=contestants,
                    uploaded_files=stored_files,
                )
            flash("Upload và cập nhật scoreboard thành công.", "success")
        except WorkbookValidationError as exc:
            shutil.rmtree(batch_dir, ignore_errors=True)
            flash(str(exc), "error")
        except Exception as exc:
            shutil.rmtree(batch_dir, ignore_errors=True)
            flash(f"Không thể xử lý file upload: {exc}", "error")
        return redirect(url_for("admin"))

    @app.post("/admin/logout")
    def admin_logout():
        session.clear()
        return redirect(url_for("admin"))

    def require_admin() -> None:
        if not session.get("is_admin"):
            abort(403)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
