from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable


def get_database_path() -> Path:
    return Path(os.getenv("DATABASE_PATH", "instance/scoreboard.sqlite3"))


@contextmanager
def connect_db():
    db_path = get_database_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with connect_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS contest_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                problems_json TEXT NOT NULL,
                stats_json TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS contestants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL,
                room TEXT NOT NULL,
                code TEXT NOT NULL,
                total_score REAL NOT NULL,
                rank INTEGER NOT NULL,
                is_top_35 INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (snapshot_id) REFERENCES contest_snapshots(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS problem_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contestant_id INTEGER NOT NULL,
                problem_code TEXT NOT NULL,
                score REAL NOT NULL,
                FOREIGN KEY (contestant_id) REFERENCES contestants(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS test_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contestant_id INTEGER NOT NULL,
                problem_code TEXT NOT NULL,
                test_name TEXT NOT NULL,
                score REAL NOT NULL,
                verdict TEXT NOT NULL,
                runtime_ms REAL,
                note TEXT,
                FOREIGN KEY (contestant_id) REFERENCES contestants(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS uploaded_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL,
                room TEXT NOT NULL,
                original_name TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                FOREIGN KEY (snapshot_id) REFERENCES contest_snapshots(id) ON DELETE CASCADE
            );
            """
        )


def get_active_snapshot(conn: sqlite3.Connection) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM contest_snapshots WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
    ).fetchone()


def replace_active_snapshot(
    conn: sqlite3.Connection,
    *,
    title: str,
    problems: list[str],
    stats: dict[str, Any],
    contestants: Iterable[dict[str, Any]],
    uploaded_files: Iterable[dict[str, str]],
) -> int:
    conn.execute("UPDATE contest_snapshots SET is_active = 0 WHERE is_active = 1")
    cur = conn.execute(
        """
        INSERT INTO contest_snapshots (title, problems_json, stats_json, is_active)
        VALUES (?, ?, ?, 1)
        """,
        (title, json.dumps(problems, ensure_ascii=False), json.dumps(stats, ensure_ascii=False)),
    )
    snapshot_id = int(cur.lastrowid)

    for item in contestants:
        cur = conn.execute(
            """
            INSERT INTO contestants (snapshot_id, room, code, total_score, rank, is_top_35)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                snapshot_id,
                item["room"],
                item["code"],
                item["total_score"],
                item["rank"],
                1 if item["is_top_35"] else 0,
            ),
        )
        contestant_id = int(cur.lastrowid)
        for problem_code, score in item["problem_scores"].items():
            conn.execute(
                """
                INSERT INTO problem_scores (contestant_id, problem_code, score)
                VALUES (?, ?, ?)
                """,
                (contestant_id, problem_code, score),
            )
        for result in item["test_results"]:
            conn.execute(
                """
                INSERT INTO test_results
                    (contestant_id, problem_code, test_name, score, verdict, runtime_ms, note)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    contestant_id,
                    result["problem_code"],
                    result["test_name"],
                    result["score"],
                    result["verdict"],
                    result["runtime_ms"],
                    result["note"],
                ),
            )

    for file_info in uploaded_files:
        conn.execute(
            """
            INSERT INTO uploaded_files (snapshot_id, room, original_name, stored_path)
            VALUES (?, ?, ?, ?)
            """,
            (snapshot_id, file_info["room"], file_info["original_name"], file_info["stored_path"]),
        )

    return snapshot_id


def fetch_scoreboard(conn: sqlite3.Connection) -> dict[str, Any] | None:
    snapshot = get_active_snapshot(conn)
    if snapshot is None:
        return None

    rows = conn.execute(
        """
        SELECT id, room, code, total_score, rank, is_top_35
        FROM contestants
        WHERE snapshot_id = ?
        ORDER BY rank ASC, code ASC
        """,
        (snapshot["id"],),
    ).fetchall()
    scores = conn.execute(
        """
        SELECT ps.contestant_id, ps.problem_code, ps.score
        FROM problem_scores ps
        JOIN contestants c ON c.id = ps.contestant_id
        WHERE c.snapshot_id = ?
        """,
        (snapshot["id"],),
    ).fetchall()

    by_contestant: dict[int, dict[str, float]] = {}
    for score in scores:
        by_contestant.setdefault(int(score["contestant_id"]), {})[score["problem_code"]] = float(score["score"])

    contestants = []
    for row in rows:
        contestants.append(
            {
                "id": row["id"],
                "rank": row["rank"],
                "room": row["room"],
                "code": row["code"],
                "total_score": row["total_score"],
                "is_top_35": bool(row["is_top_35"]),
                "problem_scores": by_contestant.get(int(row["id"]), {}),
            }
        )

    return {
        "snapshot": {
            "id": snapshot["id"],
            "title": snapshot["title"],
            "created_at": snapshot["created_at"],
        },
        "problems": json.loads(snapshot["problems_json"]),
        "stats": json.loads(snapshot["stats_json"]),
        "contestants": contestants,
    }


def fetch_contestant_detail(conn: sqlite3.Connection, contestant_id: int) -> dict[str, Any] | None:
    contestant = conn.execute(
        """
        SELECT c.*, s.problems_json
        FROM contestants c
        JOIN contest_snapshots s ON s.id = c.snapshot_id
        WHERE c.id = ? AND s.is_active = 1
        """,
        (contestant_id,),
    ).fetchone()
    if contestant is None:
        return None

    score_rows = conn.execute(
        """
        SELECT problem_code, score
        FROM problem_scores
        WHERE contestant_id = ?
        ORDER BY id ASC
        """,
        (contestant_id,),
    ).fetchall()
    test_rows = conn.execute(
        """
        SELECT problem_code, test_name, score, verdict, runtime_ms, note
        FROM test_results
        WHERE contestant_id = ?
        ORDER BY problem_code ASC, test_name ASC, id ASC
        """,
        (contestant_id,),
    ).fetchall()

    problems = json.loads(contestant["problems_json"])
    grouped = {
        problem: {
            "problem_code": problem,
            "score": 0.0,
            "tests": [],
        }
        for problem in problems
    }
    for row in score_rows:
        grouped.setdefault(
            row["problem_code"], {"problem_code": row["problem_code"], "score": 0.0, "tests": []}
        )["score"] = row["score"]
    for row in test_rows:
        grouped.setdefault(
            row["problem_code"], {"problem_code": row["problem_code"], "score": 0.0, "tests": []}
        )["tests"].append(
            {
                "test_name": row["test_name"],
                "score": row["score"],
                "verdict": row["verdict"],
                "runtime_ms": row["runtime_ms"],
                "note": row["note"],
            }
        )

    return {
        "id": contestant["id"],
        "rank": contestant["rank"],
        "room": contestant["room"],
        "code": contestant["code"],
        "total_score": contestant["total_score"],
        "is_top_35": bool(contestant["is_top_35"]),
        "problems": list(grouped.values()),
    }
