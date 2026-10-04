# Gimnasio de la demo

`scripts/demo/seed-demo.mjs` arma la base de la instancia de demo (`demo.lauyim.online`) con datos
de ejemplo de un gimnasio en marcha y la deja lista para mostrar. Todo es relativo al día en que se
corre: conviene correrlo el día antes de una reunión, así la semana, los vencimientos y las clases
de mañana están al día.

## Qué trae

- **Gimnasio Demo**: personalización con su nombre, términos y privacidad, cuotas, ingreso físico y
  clases prendidos, aprobación de cuentas nuevas.
- **Planes**: Mensual $45.000, Trimestral $120.000, 8 clases por mes $32.000 y Estudiante $38.000.
  Hace 60 días subieron: los pagos de antes guardan el precio viejo.
- **Programas**: Full Body (3 días), Torso / Pierna (4 días) y Empuje / Tirón / Piernas (3 días).
- **Clases**: Spinning y Funcional con Carolina; Pilates mat, Yoga y GAP con profes externas.
  Horario semanal con horas distintas por día, 6 semanas de historia (asistencia, ausentes,
  cancelaciones, calificaciones, lista tomada por la profe, una fecha suspendida) y la semana que
  viene con reservas, una clase llena con lista de espera y un feriado cerrado.
- **Personas** (todas con "(demo)" en el nombre, salvo Juan):

  | Perfil | Para mostrar |
  |---|---|
  | **Juan** (dueño) | el panel completo; además entrena Empuje / Tirón / Piernas desde hace 5 meses, con peso y nutrición |
  | **Carolina** (Profesor/a) | da Spinning y Funcional: su próxima clase, anotados, lista |
  | **Martín** (Recepción) | registra la mayoría de los pagos y aprobaciones |
  | **Lucía** (socia) | Torso / Pierna 4 días, racha de 12 semanas, récords, peso, nutrición, Pilates fijo los sábados, lesión de hombro cargada |
  | **Sofía** (socia) | plan 8 clases por mes, casi todo clases, primera en la lista de espera de Spinning |
  | **Diego** (socio) | cuota vencida hace 12 días: la app le muestra el bloqueo |

- **68 socios más**: estados de cuota de todo tipo (al día, por vencer, vencido, bloqueado, en
  prueba), dos cuentas pendientes de aprobar, fichas sin app, algunos que pagan pero hace semanas
  que no vienen. Llenan las clases (50 a 85 % de ocupación), el ingreso físico y el registro de
  actividad de los últimos 90 días.

Antes de reemplazar la base, el script verifica todo (tipos, rangos, que las cuotas, reservas,
asistencias e historiales cuenten una historia posible). Si algo no cierra, no toca nada.

## Cargarla en el servidor

La demo corre en `~/hub/lauyim-demo` con el proyecto `lauyim-demo`. No hace falta instalar Node: el
script corre en un contenedor de Node 22 con la copia del repo de la demo.

1. Actualizar la demo al código de `main` (el script y la API tienen que ser de la misma versión):
   ```bash
   cd ~/hub/lauyim-demo && git pull && docker compose -p lauyim-demo up -d --build
   ```
2. Parar la API de la demo (el script se niega a correr con la base abierta):
   ```bash
   docker compose -p lauyim-demo stop api
   ```
3. Armar la base (tarda unos segundos):
   ```bash
   docker run --rm -v ~/hub/lauyim-demo:/repo:ro -v ~/hub/lauyim-demo/data:/data node:22-bookworm-slim node /repo/scripts/demo/seed-demo.mjs --data /data --origin https://demo.lauyim.online
   ```
   Al final muestra el **código para entrar como Juan** (vale 72 h) y su link.
4. Levantar la API:
   ```bash
   docker compose -p lauyim-demo start api
   ```
5. En el celular, abrir el link del paso 3 (`https://demo.lauyim.online/?link=XXXX-XXXX`), crear la
   passkey y listo: sos Juan, el dueño.

La base anterior queda como `data/gym.db.antes-demo-<fecha>` (y el registro como
`audit.log.antes-demo-<fecha>`). Se pueden borrar cuando quieras.

### Mostrar la vista de un socio o de la profe

Con `--codigos-perfiles` (al final del comando del paso 3), el script también da un código para
Carolina, Martín, Lucía, Sofía y Diego: abrís el link en otro celular y ves la app como esa
persona. Sin esa opción, esos perfiles tienen la app instalada como cualquier socio y solo Juan
recibe código.

### Volver a armarla

Se puede correr las veces que haga falta (pasos 2 a 5): cada vez arma todo de cero con la fecha de
ese día. Como Juan se vuelve a crear, hay que vincularse de nuevo con el código nuevo (la passkey
vieja queda en el celular sin uso; se puede borrar desde la configuración de passkeys del
teléfono).

## Probarlo en la PC

```bash
node --test scripts/demo/seed-demo.test.mjs
```

Arma la demo en una carpeta temporal (también simulando otros días: un domingo, temprano a la
mañana, fin de mes, 29 de febrero), levanta la API y recorre las pantallas de cada perfil.

## Para cambiar los datos

Todo lo fijo (gimnasio, planes, programas, clases, personas, comidas) está en
`scripts/demo/demo-data.mjs`; el armado en `build.mjs` y los controles en `check.mjs`. Si se cambia
un plan o un horario, correr la prueba de arriba: si algo deja de cerrar, la verificación lo dice.
