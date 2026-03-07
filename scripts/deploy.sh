#!/bin/bash

# ==========================================
# DEPLOY SCRIPT - Deploy updated CORS configuration
# ==========================================

echo "=========================================="
echo "STARTING DEPLOY"
echo "Date: $(date)"
echo "=========================================="

# Step 1: Pull latest code
echo ""
echo "=== Step 1: Pulling latest code ==="
cd /root/Inbill_backend
git pull
echo "✓ Code pulled"

# Step 2: Build and restart Docker
echo ""
echo "=== Step 2: Building and restarting Docker ==="
docker compose down
docker compose up -d --build
echo "✓ Docker containers started"

# Step 3: Wait for container to be ready
echo ""
echo "=== Step 3: Waiting for container to start ==="
sleep 10

# Step 4: Check container status
echo ""
echo "=== Step 4: Container status ==="
docker compose ps

# Step 5: Check logs
echo ""
echo "=== Step 5: Recent logs ==="
docker compose logs --tail=50 app

# Step 6: Health check
echo ""
echo "=== Step 6: Health check ==="
curl -s http://localhost:3000/health || echo "Health check failed"

# Step 7: Test CORS preflight
echo ""
echo "=== Step 7: Testing CORS preflight ==="
curl -I -X OPTIONS https://hoadon.dvtienich.vn/api/auth/login \
  -H "Origin: https://inbill.dvtienich.vn" \
  -H "Access-Control-Request-Method: POST"

echo ""
echo "=========================================="
echo "DEPLOY COMPLETED"
echo "=========================================="

