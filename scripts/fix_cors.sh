#!/bin/bash

# ==========================================
# FIX CORS & PROXY SCRIPT
# ==========================================

echo "=========================================="
echo "FIXING CORS AND PROXY CONFIGURATION"
echo "=========================================="

# Backup current Caddyfile
echo ""
echo "=== Step 1: Backing up current Caddyfile ==="
cp /root/caddy-proxy/Caddyfile /root/caddy-proxy/Caddyfile.backup.$(date +%Y%m%d_%H%M%S)
echo "✓ Caddyfile backed up"

# Create new Caddyfile with CORS support
echo ""
echo "=== Step 2: Creating new Caddyfile with CORS ==="
cat > /root/caddy-proxy/Caddyfile << 'EOF'
ctvapi.dvtienich.vn {
    encode gzip zstd
    reverse_proxy inbillctv_backend-ctv_app:3000
}

hoadon.dvtienich.vn {
    encode gzip zstd
    reverse_proxy backend-app:3000
    
    # CORS Headers
    @cors_preflight {
        method OPTIONS
        header Origin "*"
    }
    
    handle @cors_preflight {
        add_header Access-Control-Allow-Origin "https://inbill.dvtienich.vn, https://hoadon.dvtienich.vn, https://ctvapi.dvtienich.vn, https://api.dvtienich.vn"
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS, PATCH"
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With, Accept, Origin"
        add_header Access-Control-Allow-Credentials "true"
        add_header Access-Control-Max-Age "86400"
        respond "" 204
    }
    
    # Add CORS headers to all responses
    handle_response {
        add_header Access-Control-Allow-Origin "https://inbill.dvtienich.vn, https://hoadon.dvtienich.vn, https://ctvapi.dvtienich.vn, https://api.dvtienich.vn" always
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS, PATCH" always
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With, Accept, Origin" always
        add_header Access-Control-Allow-Credentials "true" always
    }
}

api.dvtienich.vn {
    encode gzip zstd
    reverse_proxy mybackend:5000
}
EOF
echo "✓ New Caddyfile created"

# Reload Caddy
echo ""
echo "=== Step 3: Reloading Caddy ==="
docker exec -it global_caddy_proxy caddy reload --config /etc/caddy/Caddyfile
echo "✓ Caddy reloaded"

# Test CORS
echo ""
echo "=== Step 4: Testing CORS ==="
curl -I -X OPTIONS https://hoadon.dvtienich.vn/api/auth/login \
  -H "Origin: https://inbill.dvtienich.vn" \
  -H "Access-Control-Request-Method: POST"

echo ""
echo "=========================================="
echo "FIX COMPLETED"
echo "=========================================="

