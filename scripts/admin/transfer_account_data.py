"""Transfer all personal data from an old account to a replacement account."""

from __future__ import annotations

import argparse

from common import (
    DATA_TABLES,
    NON_TRANSFERRED_TABLES,
    backup_database,
    connect,
    ensure_same_account,
    print_summary,
    require_exact_confirmation,
    require_user,
    user_label,
    user_summary,
)


def transfer(db, source_id: str, target_id: str) -> None:
    """Move rows while preserving internal IDs and all relationships."""
    for table in DATA_TABLES:
        columns = [row[1] for row in db.execute(f"PRAGMA table_info({table})")]
        if "user_id" not in columns:
            raise RuntimeError(f"La tabla {table} no tiene la columna user_id esperada.")
        db.execute(f"UPDATE {table} SET user_id = ? WHERE user_id = ?", (target_id, source_id))


def main() -> int:
    parser = argparse.ArgumentParser(description="Copia los datos personales de una cuenta a otra.")
    parser.add_argument("source_id", help="ID de la cuenta antigua.")
    parser.add_argument("target_id", help="ID de la cuenta nueva.")
    parser.add_argument("--dry-run", action="store_true", help="Solo muestra lo que se transferiría.")
    parser.add_argument("--yes", action="store_true", help="Omite la confirmación textual.")
    args = parser.parse_args()
    ensure_same_account(args.source_id, args.target_id)

    with connect() as db:
        source = require_user(db, args.source_id)
        target = require_user(db, args.target_id)
        source_summary = user_summary(db, args.source_id)
        target_summary = user_summary(db, args.target_id)
        print(f"Origen: {user_label(source)}")
        print_summary(source_summary)
        print(f"Destino: {user_label(target)}")
        print_summary(target_summary)

        if any(target_summary.values()):
            raise RuntimeError("La cuenta destino no está vacía. No se mezclan datos automáticamente.")
        print("\nNo se transfieren credenciales/passkeys ni suscripciones push.")
        print(f"Tablas personales transferidas: {', '.join(DATA_TABLES)}")
        print(f"Tablas excluidas: {', '.join(NON_TRANSFERRED_TABLES)}")
        if args.dry_run:
            print("\nSimulación terminada: no se modificó la base.")
            return 0
        if not args.yes:
            require_exact_confirmation(args.source_id, args.target_id)

        backup = backup_database(db)
        try:
            transfer(db, args.source_id, args.target_id)
            # Copiar el nombre visible, pero no permisos, estado ni credenciales.
            db.execute("UPDATE users SET name = ? WHERE id = ?", (source["name"], args.target_id))
            resulting = user_summary(db, args.target_id)
            if resulting != source_summary:
                raise RuntimeError("La verificación posterior a la transferencia no coincide con el origen.")
            db.commit()
        except Exception:
            db.rollback()
            raise

        print(f"\nTransferencia completada. Los datos fueron movidos al destino. Backup: {backup}")
        print("Datos ahora presentes en destino:")
        print_summary(resulting)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
