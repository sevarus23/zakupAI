#!/bin/bash
# First-time SSL certificate setup for zakupai.tech
# Run this once on the server before enabling HTTPS in nginx

set -e

DOMAIN="zakupai.tech"
EMAIL="${1:?Usage: ./init-ssl.sh your@email.com}"
APP_DIR="/opt/zakupai"

cd "$APP_DIR"

# Start nginx with HTTP-only config for ACME challenge
cat > /tmp/nginx-init.conf <<'EOF'
server {
    listen 80;
    server_name zakupai.tech;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'Setting up SSL...';
        add_header Content-Type text/plain;
    }
}
EOF

# Temporarily override nginx config
docker compose -f docker-compose.prod.yml run --rm -d \
  -v /tmp/nginx-init.conf:/etc/nginx/conf.d/default.conf:ro \
  -v zakupai_certbot_data:/var/www/certbot \
  -p 80:80 \
  --name nginx-init \
  nginx

# Request certificate
docker compose -f docker-compose.prod.yml run --rm \
  certbot certonly --webroot \
  -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email

# Stop temporary nginx
docker stop nginx-init || true

echo "SSL certificate obtained! Now run: docker compose -f docker-compose.prod.yml up -d --build"
