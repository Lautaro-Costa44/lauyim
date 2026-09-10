"""Show or transfer the single Owner role."""

from __future__ import annotations

import argparse
import sys

from common import backup_database, connect, require_exact_confirmation, require_user, user_label


def main() -> int:
    parser = argparse.ArgumentParser(description="Muestra o reasigna el Owner de la instancia.")
    parser.add_argument("user_id", nargs="?", help="ID del usuario que recibirá el Owner")
    parser.add_argument("--yes", action="store_true", help="Omite la confirmación textual.")
    args = parser.parse_args()

    with connect() as db:
        owners = db.execute("SELECT id, name, admin FROM users WHERE owner = 1 ORDER BY id").fetchall()
        if args.user_id is None:
            if not owners:
                print("Owner actual: ninguno")
            else:
                print("Owner actual:")
                for owner in owners:
                    print(f"  {owner['name']} (ID: {owner['id']})")
            return 0

        target = require_user(db, args.user_id)
        if target["owner"]:
            print(f"La cuenta ya es Owner: {user_label(target)}")
            return 0
        current = owners[0] if owners else None
        print(f"Owner actual: {user_label(current) if current else 'ninguno'}")
        print(f"Nuevo Owner: {user_label(target)}")
        if not args.yes:
            require_exact_confirmation(args.user_id)

        backup = backup_database(db)
        try:
            db.execute("BEGIN")
            db.execute("UPDATE users SET owner = 0 WHERE owner = 1")
            db.execute("UPDATE users SET owner = 1, admin = 1 WHERE id = ?", (args.user_id,))
            count = db.execute("SELECT COUNT(*) FROM users WHERE owner = 1").fetchone()[0]
            if count != 1:
                raise RuntimeError(f"La reasignación dejó {count} Owners; se esperaba exactamente 1.")
            db.execute("COMMIT")
        except Exception as error:
            db.execute("ROLLBACK")
            print(f"Error al reasignar Owner; se hizo rollback: {error}", file=sys.stderr)
            return 1

        updated = require_user(db, args.user_id)
        print(f"Owner reasignado correctamente: {user_label(updated)}")
        print(f"admin: {'sí' if updated['admin'] else 'no'} | owner: {'sí' if updated['owner'] else 'no'}")
        print(f"Backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
