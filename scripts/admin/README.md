# Herramientas administrativas de cuentas

Estos scripts permiten administrar cuentas directamente sobre la base SQLite de la aplicación. Están pensados para tareas de recuperación de cuentas y mantenimiento local, no para exponer una API pública.

## Ubicación y requisitos

Los scripts viven en `scripts/admin/` y la base predeterminada es:

```text
data/gym.db
```

Requieren Python 3.10 o posterior y no necesitan paquetes externos. Si la base está en otra ubicación, se puede indicar mediante `DATA_DIR`:

```powershell
$env:DATA_DIR = "D:\ruta\a\data"
```

Antes de realizar cambios conviene detener temporalmente la API para evitar escrituras simultáneas. Los scripts de consulta son seguros con el servidor activo, aunque detenerlo también facilita obtener una fotografía consistente.

## Ver usuarios

```powershell
python scripts/admin/list_users.py
python scripts/admin/list_users.py --name "parte del nombre"
```

Muestra el ID, nombre, estado, permisos administrativos y un resumen de los principales datos personales.

## Convertir una cuenta en administradora

```powershell
python scripts/admin/make_admin.py ID_USUARIO
```

El script solicita escribir exactamente el ID. Para automatizaciones controladas existe `--yes`:

```powershell
python scripts/admin/make_admin.py ID_USUARIO --yes
```

La operación solo cambia `users.admin`. No modifica los datos personales ni las passkeys.

## Ver o reasignar el Owner

El Owner es una capa adicional sobre Admin: siempre hay como máximo uno y una cuenta Owner también es administradora.

Para ver el Owner actual:

```powershell
python scripts/admin/owner.py
```

Para reasignarlo por ID:

```powershell
python scripts/admin/owner.py ID_USUARIO
```

La operación crea un backup, desactiva el Owner anterior y asigna `owner=1` y `admin=1` al nuevo usuario dentro de una única transacción. Si algo falla, hace rollback y muestra el error. Para automatizaciones controladas existe `--yes`.

## Transferir una cuenta perdida a una cuenta nueva

La cuenta nueva debe existir y no debe tener datos personales. Esto evita mezclar historiales o sobrescribir información accidentalmente.

Primero se recomienda simular la operación:

```powershell
python scripts/admin/transfer_account_data.py ID_ANTIGUA ID_NUEVA --dry-run
```

Después, ejecutar la transferencia:

```powershell
python scripts/admin/transfer_account_data.py ID_ANTIGUA ID_NUEVA
```

Se mueve todo el contenido personal de la cuenta antigua a la nueva, manteniendo los IDs internos y sus relaciones:

- configuración y onboarding (`user_state`);
- rutinas y ejercicios de rutinas;
- planificación semanal y diaria;
- entrenamientos, ejercicios y series;
- pesos máximos y peso corporal;
- ejercicios personalizados y notas;
- recordatorios y perfiles de equipamiento;
- comidas registradas;
- plantillas de comidas y sus ingredientes.

No se copian:

- credenciales WebAuthn/passkeys;
- sesiones activas;
- suscripciones push;
- permisos administrativos;
- invitaciones y datos globales de la aplicación.

La cuenta nueva conserva su propio ID y sus propias credenciales. El nombre visible se copia desde la cuenta antigua, mientras que el destino conserva su fecha de creación, sus permisos administrativos y su estado habilitado. La cuenta antigua permanece registrada, pero queda sin esos datos personales.

La transferencia usa una transacción y crea antes un backup consistente de SQLite. Si ocurre un error, se hace rollback y la base no queda parcialmente transferida.

## Eliminar una cuenta y sus datos

Esta acción es permanente sobre la base activa. Primero se crea un backup, pero el backup debe conservarse con cuidado.

```powershell
python scripts/admin/delete_user_data.py ID_USUARIO
```

Por seguridad, la cuenta debe confirmarse escribiendo exactamente su ID. Las cuentas administradoras no se pueden eliminar por defecto:

```powershell
python scripts/admin/delete_user_data.py ID_ADMIN --allow-admin
```

`--yes` existe para ejecuciones automatizadas, pero debe usarse solo cuando el ID ya fue validado:

```powershell
python scripts/admin/delete_user_data.py ID_USUARIO --yes
```

La eliminación borra la fila de `users`; las tablas personales relacionadas utilizan las claves foráneas `ON DELETE CASCADE` del esquema. También elimina las invitaciones creadas por esa cuenta y desvincula las invitaciones que la cuenta hubiera utilizado, porque esas referencias no tienen borrado en cascada. El script comprueba que la cuenta ya no exista antes de confirmar la transacción.

## Backups

Cada operación que modifica datos crea un archivo junto a la base con este formato:

```text
data/gym.backup-AAAAMMDDTHHMMSSffffffZ.db
```

Los backups incluyen el estado consistente de la base, incluso cuando SQLite está usando WAL. No se eliminan automáticamente.

## Recuperación ante error

Si una operación se confirma por accidente, detener la API y conservar la base actual antes de restaurar. La restauración debe hacerse reemplazando la base activa por una copia del backup correspondiente y manteniendo juntos los archivos SQLite auxiliares si existieran. Después se debe iniciar la API y verificar usuarios, historial y login.

## Convenciones de seguridad

- No ejecutar estos scripts contra una base de producción sin backup verificado.
- Revisar siempre el ID completo, no solo el nombre.
- Usar `--dry-run` antes de transferir una cuenta.
- No borrar la cuenta antigua inmediatamente después de transferirla; primero comprobar que la cuenta nueva funciona.
- Las credenciales no se transfieren deliberadamente: la cuenta nueva debe registrar o utilizar sus propias passkeys.
