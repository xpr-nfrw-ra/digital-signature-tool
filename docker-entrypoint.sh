#!/usr/bin/env bash
# Container start-up: the Docker equivalent of `npm run setup` + preflight.
# Every step is skipped when its result already exists in the /app/data volume.
set -euo pipefail

DATA=/app/data
mkdir -p "$DATA/certs"

# 1. Session secret: use SESSION_SECRET if given (docker run -e ...), otherwise
#    generate one once and keep it in the volume so logins survive restarts.
if [ -z "${SESSION_SECRET:-}" ]; then
    if [ ! -s "$DATA/session_secret" ]; then
        node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > "$DATA/session_secret"
        chmod 600 "$DATA/session_secret"
        echo "Generated a new SESSION_SECRET (stored in the data volume)."
    fi
    export SESSION_SECRET="$(cat "$DATA/session_secret")"
fi

# 2. HTTPS certificate chain (Root CA -> Intermediate -> localhost server cert).
if [ ! -f "$DATA/certs/server.crt" ]; then
    echo "Creating the HTTPS certificate chain..."
    bash scripts/gen-ca-chain.sh
    echo "Copy certs/rootCA.crt out with: docker cp <container>:/app/certs/rootCA.crt ."
fi

# 3. Create / migrate the SQLite database.
npx --no-install prisma migrate deploy

# 4. Start the app (exec so Ctrl+C / docker stop reach Node's graceful shutdown).
exec "$@"
