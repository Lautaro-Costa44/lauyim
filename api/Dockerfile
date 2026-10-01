FROM node:22-alpine

ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown

LABEL maintainer="Lauyyii" \
    org.opencontainers.image.title="lauyim-api" \
    org.opencontainers.image.description="Backend de lauyim: passkeys, sincronización y administración del gimnasio." \
    org.opencontainers.image.source="https://github.com/Lautaro-Costa44/lauyim" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

# su-exec: el entrypoint baja de root al usuario node antes de arrancar la API.
RUN apk add --no-cache su-exec

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
# El código queda de root y solo de lectura para node: la API no puede modificarse a sí misma.
COPY lauyim-entrypoint.sh /usr/local/bin/lauyim-entrypoint.sh
RUN chmod 755 /usr/local/bin/lauyim-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/lauyim-entrypoint.sh"]
CMD ["node", "server.js"]

HEALTHCHECK --interval=5m \
            --timeout=5s \
            --retries=3 \
            CMD wget --spider -q "http://127.0.0.1:${PORT}/api/health" || exit 1
