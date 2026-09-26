# Entrega 0 — Verificación de los ajustes del asistente de importación

Rama: `claude/entrega-0-verificacion-import` (desde `main` @ `baec634`).

## Auditoría

| Ajuste | Estado en `main` | Dónde |
|---|---|---|
| Fila de ejemplo de la plantilla marcada "EJEMPLO – borrá esta fila" | ✅ aplicado | `api/member-import.js:20-26` (`TEMPLATE_EXAMPLE_NAME`, `TEMPLATE_EXAMPLE_DNI`), `frontend/src/views/admin/members/import-parse.js` (misma constante, un test verifica que coincidan) |
| Ignorada al importar, con warning | ✅ aplicado | `api/member-import.js:173` ("Se ignoró la fila de ejemplo de la plantilla."), tests `api/member-import.test.js`, `api/import.http.test.js:181` |
| Asistente ancho en escritorio (~960px) | ✅ aplicado | `frontend/src/index.css:641-644` (`.import-members{max-width:960px}` desde 1000px) |
| Tablas en Columnas / Planes / Vista previa | ✅ aplicado | `ImportMembersSheet.jsx` (`.import-table`), test `ImportMembers.test.jsx:246` |
| Input "Nombre del plan" con estilo de input | ✅ aplicado | `TextField` (clase `field`) + `.import-plan-inline .import-plan-name` (fondo `--surface-2`, radio) |

## Plan

Nada que implementar. Esta rama solo agrega a `docs/` los dos documentos de traspaso
(`lauyim_spec_admin_cuotas.md`, `lauyim_cambios_admin_cuotas_fichas.md`) y este archivo.

## Estado de la suite en `main`

- frontend: 64 archivos / 787 tests ✅
- api: 222/224. Los 2 que fallan (`push-send.test.js` "PUSH_AGENT solo no frena una IP literal" y
  "hostname que resuelve a loopback") fallan con `listen EAFNOSUPPORT ::`: el contenedor donde
  corrió Claude Code no tiene IPv6. No es un problema del código; en CI (ubuntu-latest) pasan.
