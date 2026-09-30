# Runbook: actualizaciones de la app (PWA)

Cómo llega una versión nueva a los socios y qué hacer cuando hay que forzarla. Código:
`frontend/public/sw.js`, `frontend/src/lib/update.js`, `frontend/src/components/UpdateGate.jsx`.

## Cómo funciona

1. Cada build genera un release (`<versión>-<hash>`, en `precache.json`) y lo escribe al final de
   `sw.js` (`self.SW_RELEASE = ...`). Así cada deploy cambia `sw.js` y el navegador instala el
   Service Worker nuevo.
2. El SW nuevo precachea su release completo y **queda en `waiting`**. No toma el control solo.
3. La app lo aplica en un **momento seguro**:
   - al abrirla, o al volver a primer plano después de 2 minutos o más en segundo plano;
   - solo si no hay un entrenamiento en curso, la cola de sync está vacía (antes intenta subirla)
     y no hay ningún sheet abierto.
4. Aplicar: la app manda `SKIP_WAITING`, el SW nuevo toma el control y la página recarga una vez.
5. Si la versión espera más de 4 horas sin un momento seguro, aparece el aviso discreto
   "Nueva versión disponible". Al tocarlo se aplica si se cumplen las condiciones; si no, dice por qué.
6. La app busca versiones nuevas al abrir y al volver a primer plano (como mucho cada 10 minutos).

El release anterior queda guardado hasta la siguiente actualización, para que una página que
todavía no recargó pueda seguir cargando sus pantallas. Si igual falta un archivo, la app recarga
una vez sola.

## Versión crítica (forzar la actualización)

Para cuando una versión vieja ya no puede funcionar con la API (por ejemplo, un cambio de formato):

1. Subí `version` en `frontend/package.json` (por ejemplo de `2.0.0` a `2.1.0`) y deployá.
2. En el `.env` de la instancia poné `MIN_CLIENT_VERSION=2.1.0` y reiniciá el contenedor de la API.
   La variable tiene que llegar al contenedor `api` (mismo lugar que `LICENSE_EXPIRES_AT`).
3. Los clientes con una versión menor ven el modal "Hay una actualización necesaria". Es la única
   interrupción: bloquea aunque haya un entrenamiento en curso (antes intenta subir la cola).
4. Si después de actualizar la app sigue vieja, el modal dice "No se pudo actualizar. Cerrá la app
   por completo y volvé a abrirla." en lugar de recargar en loop.

Para desactivarlo, borrá `MIN_CLIENT_VERSION` (o dejalo vacío) y reiniciá la API.

## Primer deploy de este cambio

Los clientes que tienen la versión anterior no saben mandar `SKIP_WAITING`. El SW nuevo queda en
`waiting` hasta que el socio **cierre la app por completo** (todas las pestañas o la PWA). A partir
de ese momento la política nueva funciona sola. Es esperable que algunos socios tarden en tomarla.

Para probarlo en dev con la versión anterior instalada: abrí la app, cerrala del todo y volvé a
abrirla; recién ahí corre la versión con la política nueva.

## Saber qué versión tiene un socio

Ajustes, al final: `lauyim v<versión> · <hash>`. El hash es el de la build que corre, también sin
conexión. Comparalo con el `release` de `https://<instancia>/precache.json`.

## Problemas comunes

- **No se actualiza nunca:** revisá que `https://<instancia>/sw.js` termine con
  `self.SW_RELEASE = "<release>"` y que coincida con `precache.json`. Si no, el build no se rehízo
  (`docker compose -p <proyecto> build --no-cache web`).
- **Se actualiza en medio de algo:** no debería. Revisá si había un sheet abierto (se posterga) o un
  entrenamiento (`S.active`).

## Instancia de demo (venta)

`DEMO_ADMIN_ALL_USERS` ya no existe (si queda en el `.env`, la API lo ignora y avisa en el log).
En su lugar:

- `NEW_USERS_ADMIN=1`: cada cuenta que se **registra** ("Crear nuevo perfil") queda admin en la
  base, como si el owner la hubiera promovido, y se le puede sacar desde Usuarios. Con la
  aprobación de cuentas encendida, queda admin recién al habilitarla.
- Nunca quedan admin: las fichas que carga el staff ni quien activa su ficha con el código del gym.
  Así los socios de ejemplo se ven como socios (con su cuota, sus bloqueos y en Ingreso Físico).
- Al cambiar la variable, las cuentas que ya existían no se tocan: las que eran socios dejan de
  entrar al panel. Si alguna tiene que seguir entrando, hacela admin desde Usuarios.
