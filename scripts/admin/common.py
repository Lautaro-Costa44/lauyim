"""Shared helpers for the local account-administration scripts."""

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_TABLES = (
    "user_state",
    "routines",
    "week_plan",
    "day_plan",
    "workouts",
    "exercise_weights",
    "bodyweight",
    "custom_exercises",
    "exercise_notes",
    "reminder_settings",
    "equip_profiles",
    "comidas_registradas",
    "plantillas_comida",
)
NON_TRANSFERRED_TABLES = ("credentials", "subscriptions")


def database_path() -> Path:
    configured = os.environ.get("DATA_DIR")
    if configured:
        configured_path = Path(configured)
        if configured_path.name == "gym.db":
            return configured_path
        return configured_path / "gym.db"
    return PROJECT_ROOT / "data" / "gym.db"


def connect(path: Path | None = None) -> sqlite3.Connection:
    db_path = path or database_path()
    if not db_path.exists():
        raise FileNotFoundError(f"No se encontró la base SQLite: {db_path}")
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def backup_database(connection: sqlite3.Connection, db_path: Path | None = None) -> Path:
    """Create a consistent SQLite backup, including WAL contents."""
    source_path = db_path or database_path()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_path = source_path.with_name(f"{source_path.stem}.backup-{stamp}.db")
    destination = sqlite3.connect(backup_path)
    try:
        connection.backup(destination)
        destination.commit()
    finally:
        destination.close()
    return backup_path


def require_user(connection: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    user = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        raise ValueError(f"No existe ningún usuario con ID: {user_id}")
    return user


def user_label(user: sqlite3.Row) -> str:
    return f"{user['name']} (ID: {user['id']})"


def count_rows(connection: sqlite3.Connection, table: str, user_id: str) -> int:
    if table not in DATA_TABLES:
        raise ValueError(f"Tabla no permitida: {table}")
    return int(connection.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (user_id,)).fetchone()[0])


def user_summary(connection: sqlite3.Connection, user_id: str) -> dict[str, int]:
    return {table: count_rows(connection, table, user_id) for table in DATA_TABLES}


def print_summary(summary: dict[str, int], indent: str = "  ") -> None:
    for table, count in summary.items():
        print(f"{indent}{table}: {count}")


def confirm(prompt: str) -> bool:
    return input(f"{prompt} [s/N]: ").strip().lower() in {"s", "si", "sí", "y", "yes"}


def require_exact_confirmation(source_id: str, target_id: str | None = None) -> None:
    expected = f"{source_id} {target_id}" if target_id is not None else source_id
    typed = input(f"Para confirmar, escribí exactamente '{expected}': ").strip()
    if typed != expected:
        raise RuntimeError("Confirmación incorrecta. No se realizó ningún cambio.")


def format_timestamp(value: object) -> str:
    if value is None:
        return "-"
    return str(value)


def table_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()]


def ensure_same_account(source_id: str, target_id: str) -> None:
    if source_id == target_id:
        raise ValueError("La cuenta de origen y la cuenta destino deben ser distintas.")


def abort(message: str) -> int:
    print(f"Error: {message}", file=sys.stderr)
    return 1
