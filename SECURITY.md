# Política de seguridad

lauyim es una plataforma de gestión de gimnasios que se ofrece como servicio: cada gimnasio tiene
su propia instancia (un contenedor y una base SQLite), administrada por lauyim.

## Versiones con soporte

Solo la rama `main`. Las instancias se actualizan desde ella; no hay versiones anteriores con
mantenimiento.

## Reportar una vulnerabilidad

No abras un issue público. Usá uno de estos canales privados:

- **GitHub:** pestaña *Security* → *Report a vulnerability* en
  <https://github.com/Lautaro-Costa44/lauyim/security/advisories/new>.
- **Mail:** <soporte@lauyim.online>, con el asunto "Seguridad".

Sumá, si podés: el commit o la versión (Ajustes → al final), la instancia afectada, los pasos
para reproducirlo y qué obtiene un atacante. Respondemos en días hábiles; no hay programa de
recompensas.

## Alcance

- `api/`: forjar o reutilizar una sesión, saltear la verificación de passkeys, leer o modificar
  datos de otro usuario, llegar a `/api/admin/*` u `/api/owner/*` sin el rol, o eludir la
  aprobación de cuentas, el bloqueo por cuota o la licencia.
- `frontend/`: XSS o cualquier forma de que otro origen lea o cambie datos de un usuario con
  sesión.
- Configuración de deploy (`web/nginx.conf.template`, Dockerfiles, scripts de backup y
  restauración).

Fuera de alcance: ataques que requieren acceso al servidor o al dispositivo desbloqueado del
usuario, denegación de servicio por volumen y avisos de escáneres sin un impacto concreto.

## Notas para operar una instancia

- `data/` contiene la base, `secret` (firma de las sesiones) y `vapid.json`. Nunca se versiona:
  quien tenga `secret` puede firmar una sesión válida para cualquier cuenta. Si se filtra,
  borralo y reiniciá la API: se genera uno nuevo y todas las sesiones se cierran.
- Los backups llevan `secret` y datos personales: solo se suben a un remote `crypt` de rclone
  (ver `docs/backup-restore.md`). Después de restaurar un backup anterior a una rotación del
  secreto, volvé a rotarlo.
- El puerto web se publica solo en `127.0.0.1`; el acceso público entra por Cloudflare Tunnel.
