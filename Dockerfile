# Digital Signature Tool — container image
# Build:  docker build -t signtool:1.0 .
# Run:    docker run -d --name signtool -p 3443:3443 -v signtool-data:/app/data signtool:1.0
#
# No secrets are baked into the image: the session secret, the SQLite database and the
# HTTPS certificate chain are created on first start inside the /app/data volume.

FROM node:22-bookworm-slim

# openssl: generates the CA chain (scripts/gen-ca-chain.sh); bash runs that script.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so this layer is cached when only source code changes.
# Dev dependencies are kept on purpose: the Prisma CLI applies migrations at startup.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY .env.example ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# The certs/ folder the server reads is a link into the data volume, so certificates
# survive container re-creation and the Root CA stays the same (trust it only once).
RUN chmod +x /usr/local/bin/docker-entrypoint.sh scripts/gen-ca-chain.sh \
 && mkdir -p /app/data \
 && ln -s /app/data/certs /app/certs \
 && chown -R node:node /app

USER node

ENV NODE_ENV=production \
    DATABASE_URL="file:./data/dev.db"

VOLUME ["/app/data"]
EXPOSE 3443

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/server.js"]
