#!/usr/bin/env bash
set -euo pipefail

# SP-Kickstack: Live Multi-Repo Engine Spike Setup
# Prepares two test git repositories for live cross-repo agent testing.

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/workspace/spike"
echo "Creating spike workspace in: ${WORKSPACE_DIR}"

mkdir -p "${WORKSPACE_DIR}"
rm -rf "${WORKSPACE_DIR}/backend" "${WORKSPACE_DIR}/frontend"

# 1. Initialize test backend repo
echo "Initializing test backend repository..."
mkdir -p "${WORKSPACE_DIR}/backend"
cd "${WORKSPACE_DIR}/backend"
git init -b main
git config user.name "Spike Bot"
git config user.email "spike@kickstack.local"

cat <<'EOF' > README.md
# Test Backend Service
Microservice providing core REST APIs for the spike scenario.
EOF

cat <<'EOF' > openapi.yaml
openapi: 3.0.3
info:
  title: Test Backend API
  version: 1.0.0
paths:
  /health:
    get:
      summary: Health check
      responses:
        '200':
          description: OK
EOF

mkdir -p .stoneforge
cat <<'EOF' > .stoneforge/config.json
{
  "engine": "stoneforge",
  "port": 3457,
  "role": "backend",
  "merge_policy": "manual_review"
}
EOF

git add .
git commit -m "initial commit: backend service setup"

# 2. Initialize test frontend repo
echo "Initializing test frontend repository..."
mkdir -p "${WORKSPACE_DIR}/frontend"
cd "${WORKSPACE_DIR}/frontend"
git init -b main
git config user.name "Spike Bot"
git config user.email "spike@kickstack.local"

cat <<'EOF' > README.md
# Test Frontend Client
Client application consuming backend REST endpoints.
EOF

mkdir -p .stoneforge .devflow/outbox
cat <<'EOF' > .stoneforge/config.json
{
  "engine": "stoneforge",
  "port": 3477,
  "role": "frontend",
  "merge_policy": "auto_merge_main"
}
EOF

git add .
git commit -m "initial commit: frontend client setup"

echo ""
echo "=== Spike Repositories Initialized Successfully ==="
echo "Backend:  ${WORKSPACE_DIR}/backend"
echo "Frontend: ${WORKSPACE_DIR}/frontend"
