"""Permanently delete a user and every personal row linked to that user."""

from __future__ import annotations

import argparse

from common import backup_database, connect, print_summary, require_exact_confirmation, require_user, user_label, user_summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Elimina una cuenta y todos sus datos personales.")
    parser.add_argument("user_id")
    parser.add_argument("--allow-admin", action="store_true", help="Permite eliminar también una cuenta administradora.")
    parser.add_argument("--yes", action="store_true", help="Omite la confirmación textual.")
    args = parser.parse_args()

    with connect() as db:
        user = require_user(db, args.user_id)
        if user["admin"] and not args.allow_admin:
            raise RuntimeError("La cuenta es administradora. Usá --allow-admin si la eliminación es intencional.")
        summary = user_summary(db, args.user_id)
        print(f"Se eliminará permanentemente: {user_label(user)}")
        print_summary(summary)
        if not args.yes:
            require_exact_confirmation(args.user_id)

        backup = backup_database(db)
        try:
            # Invites reference users without ON DELETE CASCADE. Remove invites
            # created by this account and detach invites redeemed by it first.
            db.execute("DELETE FROM invites WHERE created_by = ?", (args.user_id,))
            db.execute("UPDATE invites SET used_by = NULL WHERE used_by = ?", (args.user_id,))
            db.execute("DELETE FROM users WHERE id = ?", (args.user_id,))
            if db.execute("SELECT 1 FROM users WHERE id = ?", (args.user_id,)).fetchone() is not None:
                raise RuntimeError("La cuenta no pudo eliminarse completamente.")
            remaining = {table: db.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (args.user_id,)).fetchone()[0] for table in summary}
            if any(remaining.values()):
                raise RuntimeError(f"Quedaron datos asociados a la cuenta: {remaining}")
            db.commit()
        except Exception:
            db.rollback()
            raise
        print(f"Cuenta y datos eliminados. Backup recuperable creado en: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
