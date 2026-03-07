#!/bin/bash

# ==========================================
# ROLLBACK SCRIPT - Emergency Rollback to 2026-03-06
# ==========================================

echo "=========================================="
echo "STARTING EMERGENCY ROLLBACK"
echo "Date: $(date)"
echo "=========================================="

# Step 1: Backup current state
echo ""
echo "=== Step 1: Backing up current state ==="
mkdir -p /root/rollback_2026-03-06

if [ -f /root/Inbill_backend/docker-compose.yml ]; then
    cp /root/Inbill_backend/docker-compose.yml /root/rollback_2026-03-06/docker-compose.yml.now
    echo "✓ Backed up docker-compose.yml"
fi

if [ -f /root/Inbill_backend/.env ]; then
    cp /root/Inbill_backend/.env /root/rollback_2026-03-06/inbill.env.now
    echo "✓ Backed up .env"
fi

if [ -f /root/caddy-proxy/Caddyfile ]; then
    cp /root/caddy-proxy/Caddyfile /root/rollback_2026-03-06/Caddyfile.now
    echo "✓ Backed up Caddyfile"
fi

# Step 2: Show git reflog for reference
echo ""
echo "=== Step 2: Git Reflog (last 20) ==="
cd /root/Inbill_backend
git reflog -n 20

# Step 3: Rollback BE code to stable commit
# Based on reflog, 59fabd7 is the last stable commit before today's "docker check" commits
echo ""
echo "=== Step 3: Rolling back BE code ==="
echo "Rolling back to: 59fabd7 (chore: final deep scan fixes, health checks, and reports)"
git reset --hard 59fabd7
echo "✓ Code rolled back to 59fabd7"

# Step 4: Update docker-compose.yml to use port 4000
echo ""
echo "=== Step 4: Updating docker-compose.yml ==="
cat > /root/Inbill_backend/docker-compose.yml << 'EOF'
version: '3.8'

services:
  app:
    container_name: backend-app
    build: .
    ports:
      - "4000:4000"
    env_file:
      - .env
EOF
echo "✓ Updated docker-compose.yml to use port 4000"

# Step 5: Deploy clean BE
echo ""
echo "=== Step 5: Deploying clean BE ==="
cd /root/Inbill_backend
docker compose down --remove-orphans
echo "✓ Stopped old containers"

docker compose up -d --build
echo "✓ Started new containers"

echo ""
echo "=== Docker Compose PS ==="
docker compose ps

echo ""
echo "=== Docker Compose Logs (last 200 lines) ==="
docker compose logs --tail=200 app

echo ""
echo "=== Health Check ==="
curl -s http://localhost:4000/health || echo "Health check failed - might need to wait for container to start"

# Step 6: Restore Caddyfile to old upstream configuration
echo ""
echo "=== Step 6: Restoring Caddyfile ==="
cat > /root/caddy-proxy/Caddyfile << 'EOF'
ctvapi.dvtienich.vn {
    encode gzip zstd
    reverse_proxy inbillctv_backend-ctv_app:3000
}

hoadon.dvtienich.vn {
    encode gzip zstd
    reverse_proxy backend-app:4000
}

api.dvtienich.vn {
    encode gzip zstd
    reverse_proxy mybackend:5000
}
EOF
echo "✓ Updated Caddyfile"

# Step 7: Reload Caddy
echo ""
echo "=== Step 7: Reloading Caddy ==="
docker exec -it global_caddy_proxy caddy reload --config /etc/caddy/Caddyfile

echo ""
echo "=========================================="
echo "ROLLBACK COMPLETED"
echo "=========================================="
echo ""
echo "Please run these commands to verify:"
echo "  1. docker compose ps (in /root/Inbill_backend)"
echo "  2. curl -I https://hoadon.dvtienich.vn"
echo "  3. curl -I https://hoadon.dvtienich.vn/health"
echo "  4. docker exec -it global_caddy_proxy caddy validate --config /etc/caddy/Caddyfile"

