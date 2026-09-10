"""List users and useful account activity information."""

from __future__ import annotations

import argparse

from common import connect, format_timestamp, user_summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Muestra usuarios y un resumen de sus datos.")
    parser.add_argument("--name", help="Filtra por parte del nombre (sin distinguir mayúsculas).")
    args = parser.parse_args()

    with connect() as db:
        query = "SELECT id, name, admin, owner, disabled, created_at FROM users"
        params: tuple[str, ...] = ()
        if args.name:
            query += " WHERE name LIKE ? COLLATE NOCASE"
            params = (f"%{args.name}%",)
        query += " ORDER BY name COLLATE NOCASE, id"
        users = db.execute(query, params).fetchall()
        if not users:
            print("No se encontraron usuarios.")
            return 0
        for user in users:
            summary = user_summary(db, user["id"])
            last_workout = db.execute(
                "SELECT MAX(start) FROM workouts WHERE user_id = ?", (user["id"],)
            ).fetchone()[0]
            print(f"{user['name']} | ID: {user['id']}")
            print(f"  creado: {format_timestamp(user['created_at'])} | admin: {'sí' if user['admin'] else 'no'} | owner: {'sí' if user['owner'] else 'no'} | deshabilitado: {'sí' if user['disabled'] else 'no'}")
            print(f"  entrenamientos: {summary['workouts']} | último entrenamiento: {format_timestamp(last_workout)}")
            print(f"  peso corporal: {summary['bodyweight']} | comidas: {summary['comidas_registradas']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
