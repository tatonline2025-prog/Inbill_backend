#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-migration/allbill-backend-base}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-inbill_backend}"
APP_URL="${APP_URL:-http://localhost:3000}"

echo "=========================================="
echo "STARTING BACKEND DEPLOY"
echo "Date: $(date)"
echo "App dir: $APP_DIR"
echo "Branch: $DEPLOY_BRANCH"
echo "Compose project: $COMPOSE_PROJECT_NAME"
echo "=========================================="

cd "$APP_DIR"

if [[ ! -d .git ]]; then
  echo "Missing .git in $APP_DIR"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env in $APP_DIR"
  exit 1
fi

echo
echo "=== Step 1: Sync code from GitHub ==="
git fetch "$DEPLOY_REMOTE"
git checkout "$DEPLOY_BRANCH"
git reset --hard "$DEPLOY_REMOTE/$DEPLOY_BRANCH"
echo "Code synced to $(git rev-parse --short HEAD)"

echo
echo "=== Step 2: Build and restart Docker ==="
docker compose -p "$COMPOSE_PROJECT_NAME" up -d --build
echo "Containers rebuilt"

echo
echo "=== Step 3: Wait for app ==="
sleep 10

echo
echo "=== Step 4: Container status ==="
docker compose -p "$COMPOSE_PROJECT_NAME" ps

echo
echo "=== Step 5: Recent logs ==="
docker compose -p "$COMPOSE_PROJECT_NAME" logs --tail=50 app

echo
echo "=== Step 6: Basic HTTP probe ==="
HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" "$APP_URL/" || true)"
echo "GET $APP_URL/ -> ${HTTP_CODE:-no-response}"

echo
echo "=========================================="
echo "DEPLOY COMPLETED"
echo "=========================================="
