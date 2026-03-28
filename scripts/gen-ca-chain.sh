#!/usr/bin/env bash
# gen-ca-chain.sh — Build a 3-tier PKI: Root CA → Intermediate CA → Server cert
# Output goes to ../certs/ relative to this script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/../certs"

mkdir -p "$CERTS_DIR"

# Abort if chain already exists
if [ -f "$CERTS_DIR/server.crt" ] && [ -f "$CERTS_DIR/server.key" ]; then
    echo "Certificate chain already exists in certs/. Delete certs/ to regenerate."
    exit 0
fi

echo "=== 1/4  Root CA ==="
openssl genrsa -out "$CERTS_DIR/rootCA.key" 4096
openssl req -x509 -new -nodes \
    -key "$CERTS_DIR/rootCA.key" \
    -sha256 -days 3650 \
    -subj "/C=US/ST=Dev/O=Digital Signature Tool/CN=Root CA" \
    -out "$CERTS_DIR/rootCA.crt"

echo "=== 2/4  Intermediate CA ==="
openssl genrsa -out "$CERTS_DIR/intermediate.key" 4096
openssl req -new \
    -key "$CERTS_DIR/intermediate.key" \
    -subj "/C=US/ST=Dev/O=Digital Signature Tool/CN=Intermediate CA" \
    -out "$CERTS_DIR/intermediate.csr"

# Intermediate CA extensions: allow it to sign certificates
cat > "$CERTS_DIR/intermediate_ext.cnf" <<INTEOF
[v3_intermediate_ca]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
INTEOF

openssl x509 -req \
    -in "$CERTS_DIR/intermediate.csr" \
    -CA "$CERTS_DIR/rootCA.crt" \
    -CAkey "$CERTS_DIR/rootCA.key" \
    -CAcreateserial \
    -sha256 -days 1825 \
    -extfile "$CERTS_DIR/intermediate_ext.cnf" \
    -extensions v3_intermediate_ca \
    -out "$CERTS_DIR/intermediate.crt"

echo "=== 3/4  Server certificate ==="
openssl genrsa -out "$CERTS_DIR/server.key" 2048
openssl req -new \
    -key "$CERTS_DIR/server.key" \
    -subj "/C=US/ST=Dev/O=Digital Signature Tool/CN=localhost" \
    -out "$CERTS_DIR/server.csr"

# Server cert extensions: SANs for localhost and 127.0.0.1
cat > "$CERTS_DIR/server_ext.cnf" <<SRVEOF
[server_cert]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = signtool.local
IP.1 = 127.0.0.1
SRVEOF

openssl x509 -req \
    -in "$CERTS_DIR/server.csr" \
    -CA "$CERTS_DIR/intermediate.crt" \
    -CAkey "$CERTS_DIR/intermediate.key" \
    -CAcreateserial \
    -sha256 -days 365 \
    -extfile "$CERTS_DIR/server_ext.cnf" \
    -extensions server_cert \
    -out "$CERTS_DIR/server.crt"

echo "=== 4/4  Building chain bundle ==="
# chain.crt = intermediate + root (sent to clients during TLS handshake)
cat "$CERTS_DIR/intermediate.crt" "$CERTS_DIR/rootCA.crt" > "$CERTS_DIR/chain.crt"

# Clean up CSRs and temp config files
rm -f "$CERTS_DIR"/*.csr "$CERTS_DIR"/*.cnf "$CERTS_DIR"/*.srl

echo ""
echo "Done! Files in certs/:"
ls -1 "$CERTS_DIR"
echo ""
echo "Next steps:"
echo "  1. Import certs/rootCA.crt into your OS/browser trusted root store"
echo "     Windows: certmgr.msc → Trusted Root Certification Authorities → Import"
echo "  2. npm start"
echo "  3. Open https://localhost:3443 (no certificate warning after trust import)"
