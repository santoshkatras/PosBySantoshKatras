#!/usr/bin/env bash
# One-time setup of SKPOS on an Ubuntu 24.04 AWS Lightsail / EC2 instance.
# Usage (on the server): sudo bash aws-setup.sh [domain]
set -euo pipefail
DOMAIN="${1:-}"
APP=/opt/skpos
apt-get update -y
apt-get install -y curl nginx
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
id skpos >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin skpos
mkdir -p "$APP" /var/lib/skpos /var/backups/skpos
chown -R skpos:skpos /var/lib/skpos
cat >/etc/systemd/system/skpos.service <<UNIT
[Unit]
Description=SKPOS
After=network.target
[Service]
User=skpos
WorkingDirectory=$APP
Environment=NODE_ENV=production
Environment=PORT=9000
Environment=STORE=file
Environment=DATA_FILE=/var/lib/skpos/skpos-data.json
ExecStart=/usr/bin/node server/start.mjs
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
cat >/etc/nginx/sites-available/skpos <<NGINX
server {
  listen 80;
  server_name ${DOMAIN:-_};
  client_max_body_size 5m;
  location / {
    proxy_pass http://127.0.0.1:9000;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINX
ln -sf /etc/nginx/sites-available/skpos /etc/nginx/sites-enabled/skpos
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
# nightly backup of the data file, keep 30 days
cat >/etc/cron.daily/skpos-backup <<'CRON'
#!/bin/sh
[ -f /var/lib/skpos/skpos-data.json ] && cp /var/lib/skpos/skpos-data.json /var/backups/skpos/skpos-$(date +%F).json
find /var/backups/skpos -name 'skpos-*.json' -mtime +30 -delete
CRON
chmod +x /etc/cron.daily/skpos-backup
systemctl daemon-reload
systemctl enable skpos
if [ -n "$DOMAIN" ]; then
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "HTTPS not set up yet — point the domain to this server first."
fi
echo "Setup done. Copy the app to $APP, run: cd $APP && npm ci --omit=dev && npm run build, then: systemctl restart skpos"
