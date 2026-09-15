"""Grant administrator status to one existing user."""

from __future__ import annotations

import argparse

from common import connect, require_exact_confirmation, require_user, user_label


def main() -> int:
    parser = argparse.ArgumentParser(description="Convierte una cuenta existente en administradora.")
    parser.add_argument("user_id")
    parser.add_argument("--yes", action="store_true", help="Omite la confirmación textual.")
    args = parser.parse_args()

    with connect() as db:
        user = require_user(db, args.user_id)
        if user["admin"]:
            print(f"La cuenta ya es administradora: {user_label(user)}")
            return 0
        print(f"Cuenta seleccionada: {user_label(user)}")
        if not args.yes:
            require_exact_confirmation(args.user_id)
        try:
            db.execute("UPDATE users SET admin = 1 WHERE id = ?", (args.user_id,))
            db.commit()
        except Exception:
            db.rollback()
            raise
        print(f"Cuenta convertida en administradora: {user_label(user)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
