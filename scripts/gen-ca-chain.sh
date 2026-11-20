#!/usr/bin/env bash
# gen-ca-chain.sh — Build a 3-tier PKI: Root CA → Intermediate CA → Server cert
# Output goes to ../certs/ relative to this script.

set -euo pipefail

# Git Bash on Windows rewrites arguments that look like Unix paths, which turns
# -subj "/C=US/..." into "C:/Program Files/Git/C=US/...". Turn that off; other
# platforms ignore these variables.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/../certs"

mkdir -p "$CERTS_DIR"

# Work inside certs/ and give openssl plain file names only. On Windows, PATH may find
# a native openssl.exe (e.g. Git's mingw64 build) that can't read Git Bash paths like
# /c/Users/..., and path conversion is off (see above). Relative names work for every
# openssl build on every platform.
cd "$CERTS_DIR"

# Abort if chain already exists
if [ -f server.crt ] && [ -f server.key ]; then
    echo "Certificate chain already exists in certs/. Delete certs/ to regenerate."
    exit 0
fi

# Both CAs may only vouch for these names (and subdomains of the DNS names). Without
# this, a trusted Root CA could sign certificates for any website, so anyone who got
# hold of rootCA.key or intermediate.key could impersonate e.g. a bank on this machine.
# Must cover every SAN of the server certificate below.
NAME_CONSTRAINTS="critical, permitted;DNS:localhost, permitted;DNS:signtool.local, permitted;IP:127.0.0.1/255.255.255.255"

echo "=== 1/4  Root CA ==="
openssl genrsa -out rootCA.key 4096
openssl req -x509 -new -nodes \
    -key rootCA.key \
    -sha256 -days 3650 \
    -subj "/C=US/ST=Dev/O=Digital Signature Tool/CN=Root CA" \
    -addext "nameConstraints = $NAME_CONSTRAINTS" \
    -out rootCA.crt

echo "=== 2/4  Intermediate CA ==="
openssl genrsa -out intermediate.key 4096
openssl req -new \
    -key intermediate.key \
    -subj "/C=US/ST=Dev/O=Digital Signature Tool/CN=Intermediate CA" \
    -out intermediate.csr

# Intermediate CA extensions: allow it to sign certificates
cat > intermediate_ext.cnf <<INTEOF
[v3_intermediate_ca]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
nameConstraints = $NAME_CONSTRAINTS
INTEOF

openssl x509 -req \
    -in intermediate.csr \
    -CA rootCA.crt \
    -CAkey rootCA.key \
    -CAcreateserial \
    -sha256 -days 1825 \
    -extfile intermediate_ext.cnf \
    -extensions v3_intermediate_ca \
    -out intermediate.crt

echo "=== 3/4  Server certificate ==="
openssl genrsa -out server.key 2048
openssl req -new \
    -key server.key \
    -subj "/C=US/ST=Dev/O=Digital Signature Tool/CN=localhost" \
    -out server.csr

# Server cert extensions: SANs for localhost and 127.0.0.1
cat > server_ext.cnf <<SRVEOF
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
    -in server.csr \
    -CA intermediate.crt \
    -CAkey intermediate.key \
    -CAcreateserial \
    -sha256 -days 365 \
    -extfile server_ext.cnf \
    -extensions server_cert \
    -out server.crt

echo "=== 4/4  Building chain bundle ==="
# chain.crt = intermediate + root (sent to clients during TLS handshake)
cat intermediate.crt rootCA.crt > chain.crt

# Clean up CSRs and temp config files
rm -f ./*.csr ./*.cnf ./*.srl

echo ""
echo "Done! Files in certs/:"
ls -1
echo ""
echo "Next: trust certs/rootCA.crt once - see \"Trust the certificate\" in README.md."
