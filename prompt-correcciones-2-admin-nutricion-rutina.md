# Prompt — Correcciones ronda 2: "Administrar Nutrición/Rutina" (lauyim)

## Contexto

Trabajás sobre **lauyim** (siempre minúscula): React + Vite + Zustand, backend Node.js nativo (`node:http`, `node:sqlite`), SQLite.

La feature "Administrar Nutrición/Rutina" ya está implementada y la ronda anterior de correcciones fue aplicada. Esta tarea son **correcciones puntuales de bugs y de estética** sobre lo que ya existe. **No rehagas nada: auditá los componentes actuales y hacé cambios quirúrgicos.**

**Antes de escribir código: mostrame el plan (archivos a tocar + diff propuesto) y esperá confirmación.**

### Reglas que siguen vigentes
- Prioridad total del admin sobre lo que ve el socio; sin merge con globales cuando hay algo asignado.
- El socio no ve ningún indicio de que su configuración la cargó un admin.
- Nada de optimistic locking ni campos de versión (el versionado es git).
- Cualquier migración se autoaplica al levantar el contenedor, dentro de `initDatabase()`, idempotente.
- Usuario desactivado no se puede modificar; el chequeo ya existe, no lo dupliques.
- Reutilizar componentes y estilos existentes de la app. Tema oscuro, acento rojo. No introducir estilos nuevos ni librerías.
- Toda mutación administrativa queda auditada con el helper centralizado.

---

## Parte A — BUGS (prioridad, bloquean el uso)

### A.1 Cambiar de grupo no cambia las rutinas mostradas

Al tocar otro tab de grupo (ej. pasar de "Mi Plan" a "Nuevo Grupo"), el tab se marca como activo pero **la lista de rutinas de abajo sigue mostrando las del grupo anterior**. En la captura, con "Nuevo Grupo" seleccionado se siguen viendo Push Day / Pull Day / Leg Day, que pertenecen a "Mi Plan".

- Diagnosticá primero: lo más probable es que la lista se esté renderizando desde un estado que no depende del grupo activo, o que el filtro por grupo no se esté aplicando al cambiar el tab (estado inicial cacheado, `useEffect` sin el grupo en las dependencias, o el fetch/filtrado ejecutándose una sola vez al montar).
- La lista debe derivarse siempre del grupo activo. Si el grupo seleccionado no tiene rutinas, mostrar un estado vacío propio del grupo (ej. "Este grupo todavía no tiene rutinas") con el botón `+ Crear rutina` disponible.
- Mostrame el diagnóstico antes del fix.

### A.2 "+ Crear rutina" rompe la app

El botón `+ Crear rutina` lleva a **una pantalla en gris de la que no se puede salir** — la vista queda colgada sin forma de volver.

- Diagnosticá la causa: probablemente abre el editor de rutina (`RoutineEdit.jsx`) en modo administrativo sin los datos mínimos que ese componente espera (rutina inexistente / `id` nulo / `userId` objetivo no propagado), y al no tener rutina que renderizar queda en un estado intermedio sin header ni botón de cerrar.
- El flujo correcto: `+ Crear rutina` crea una rutina nueva vacía dentro del **grupo activo** y del **socio objetivo**, y recién ahí abre el editor con esa rutina ya existente; o abre un diálogo de nombre y crea después. Elegí la opción que menos toque el flujo actual del editor.
- La pantalla resultante **siempre** debe tener forma de salir (botón cerrar/volver visible), incluso si falla la carga.
- Verificá que el editor administrativo reciba y use el `userId` del socio en todas sus operaciones — no debe escribir sobre las rutinas del admin logueado.

---

## Parte B — Estética pestaña NUTRICIÓN

### B.1 Espacio antes del formulario de metas

Falta separación entre la fila "Objetivo" y los campos numéricos de abajo. Agregá espaciado vertical para que se lean como dos bloques distintos dentro de la misma tarjeta.

### B.2 Rehacer la estética de los inputs numéricos

Los campos "Kcalorías a quemar", "Kcalorías a consumir", "Proteínas (g)", "Carbohidratos (g)" y "Grasas (g)" hoy se ven mal: son **cajas blancas** que rompen el tema oscuro, con **anchos distintos** entre sí y con el label pegado al campo, quedando desalineados.

Corregir a:
- Inputs con el estilo oscuro de la app (fondo de superficie del tema, borde sutil, texto claro), nunca fondo blanco.
- **Todos del mismo ancho**, alineados a la derecha o a ancho completo — consistentes entre sí.
- Labels alineados entre sí, con separación clara del campo.
- Usá el mismo patrón de fila/campo que ya existe en otras pantallas de la app (`Row` / `SelectRow` o el componente de input que ya se use en Settings) en lugar de estilos ad-hoc.
- Los campos siguen arrancando **vacíos** por defecto (nada de `0` ni valores precargados).

### B.3 Botón "Guardar metas" centrado

Hoy está alineado a la izquierda. Centralo horizontalmente y dale el margen superior necesario para separarlo del último campo.

### B.4 Recuadro gris de estado vacío con más espacio

El recuadro "Sin sugerencias asignadas" está muy apretado (la altura es apenas la del texto). Aumentá su padding vertical para que respire, y agregá separación entre ese recuadro y el botón `+ Agregar sugerencia`, que hoy queda pegado encima.

---

## Parte C — Estética pestaña RUTINA

### C.1 Recuadros grises de estado vacío

Mismo problema que B.4, en dos lugares:
- "Ninguna registrada" (bloque Lesiones)
- "Este usuario todavía no tiene ningún plan ni rutina creada" (bloque Rutinas)

Aumentá el padding vertical de ambos y dejá separación respecto del botón que va debajo (`+ Agregar` y `+ Crear grupo`).

**Aplicá el mismo tratamiento a todos los recuadros de estado vacío de esta vista**, para que queden consistentes entre pestañas — idealmente extrayendo un único componente de "estado vacío" reutilizable en lugar de repetir estilos.

### C.2 Corregir el texto del estado vacío

El texto dice "no tiene ningún **plan** ni rutina creada", pero la nomenclatura acordada en la UI es **"grupo"**, no "plan". Debe decir:

> Este usuario todavía no tiene ningún grupo ni rutina creada

Revisá que no haya quedado la palabra "Plan" en ningún otro texto de esta vista (botones, títulos, mensajes). La excepción son los **nombres propios de grupos creados por el usuario** (ej. un grupo llamado "Mi Plan"), que no se tocan.

---

## Parte D — Verificación

1. La suite existente debe seguir pasando.
2. Verificar manualmente en un teléfono real (la vista es mobile-first; las capturas del problema son de Android en modo oscuro):
   - Cambiar entre grupos actualiza la lista de rutinas correctamente, incluido un grupo vacío.
   - `+ Crear rutina` crea la rutina en el grupo y socio correctos y el editor se puede cerrar siempre.
   - Los inputs de metas se ven en tema oscuro, del mismo ancho, y guardan/limpian correctamente (vacío → `null`, no `0`).
   - Los recuadros de estado vacío se ven parejos en ambas pestañas.
3. Desplegar primero en `dev.lauyim.online` y validar ahí antes de producción.

---

## Formato de entrega

Por cada parte: (1) archivos que vas a tocar, (2) diff propuesto, (3) cómo probarlo. Empezá por la **Parte A** (los dos bugs), que bloquean la validación del resto. No avances a la parte siguiente sin confirmación.
