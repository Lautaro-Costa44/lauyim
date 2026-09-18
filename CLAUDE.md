Lauyyii is developing and commercializing lauyim (always lowercase — never "Lauyim App" or "Lauyim Gym"), a white-label PWA gym management platform
Deployed as isolated per-gym instances: one Docker container + SQLite per gym, behind Cloudflare Tunnel
B2B model targets gym owners; each client gets their own instance, billed manually via LICENSE_EXPIRES_AT — no Stripe, no multi-tenant SaaS architecture needed
Custom fork of openGym (DuarteSantos8/openGym) under AGPL-3.0
AGPL compliance handled via Option A: open code, sell the service rather than software exclusivity
Tech stack
Frontend: React + Vite + Zustand
Backend: Node.js with native node:http and node:sqlite — no Express, no better-sqlite3
Database: SQLite with WAL mode
Auth: WebAuthn/Passkeys
Infrastructure: Docker Compose on a Debian server (hostname servidor-lauti, user lauyyii), Cloudflare Tunnel
Production: lauyim.online, at ~/hub/lauyim, Docker project -p lauyim
Dev: dev.lauyim.online, at ~/hub/lauyim-dev, Docker project -p lauyim-dev
Public repo: github.com/Lautaro-Costa44/lauyim



**Reglas de Comportamiento:**
- Responde en formato ultra directo y breve (Caveman mode).
- NO ejecutes escaneos globales de carpetas (`find`, `ls -R`).
