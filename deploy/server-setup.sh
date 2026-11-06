#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 server for Bungee Fly. Run as root. Safe to re-run.
# Everything runs on this one machine: PostgreSQL (local only), Node app (local only), nginx + HTTPS in front.
# Usage: bash server-setup.sh <public-hostname> <public-ip>
set -euo pipefail
HOST="${1:?usage: server-setup.sh <public-hostname> <public-ip>}"
IP="${2:?usage: server-setup.sh <public-hostname> <public-ip>}"
ENV=/etc/bungee-fly/env
APP=/srv/bungee-fly
export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update -q
apt-get -yq -o Dpkg::Options::=--force-confold upgrade
apt-get install -yq --no-install-recommends ca-certificates curl gnupg unzip openssl ufw fail2ban nginx \
  certbot python3-certbot-nginx postgresql postgresql-contrib unattended-upgrades

echo "== automatic security updates"
printf '%s\n' 'APT::Periodic::Update-Package-Lists "1";' 'APT::Periodic::Unattended-Upgrade "1";' \
  > /etc/apt/apt.conf.d/20auto-upgrades

echo "== swap (2 GB RAM: the build needs headroom)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-bungee.conf && sysctl -q -p /etc/sysctl.d/99-bungee.conf

echo "== logs capped at 200 MB"
mkdir -p /etc/systemd/journald.conf.d
printf '%s\n' '[Journal]' 'SystemMaxUse=200M' > /etc/systemd/journald.conf.d/size.conf
systemctl restart systemd-journald

echo "== firewall: SSH + web only"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status | head -8

echo "== fail2ban: block repeated SSH login attempts"
printf '%s\n' '[sshd]' 'enabled = true' 'maxretry = 5' 'bantime = 1h' > /etc/fail2ban/jail.d/sshd.local
systemctl enable -q fail2ban && systemctl restart fail2ban

echo "== Node.js 22"
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -yq nodejs
fi
node -v

echo "== Bun (installs packages + builds)"
if ! [ -x /opt/bun/bin/bun ]; then
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/opt/bun bash -s "bun-v1.2.17" >/dev/null
fi
ln -sf /opt/bun/bin/bun /usr/local/bin/bun
ln -sf /opt/bun/bin/bun /usr/local/bin/bunx
bun --version

echo "== app user + folders"
id bungee >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP" --shell /usr/sbin/nologin bungee
install -d -o bungee -g bungee "$APP/releases" "$APP/build"
install -d -m 750 -o root -g bungee /etc/bungee-fly
install -d -m 700 -o postgres -g postgres /var/backups/bungee-fly

echo "== PostgreSQL (open source, this machine only)"
systemctl enable -q --now postgresql
PGVER=$(ls /etc/postgresql | sort -V | tail -1)
printf '%s\n' "listen_addresses = 'localhost'" "shared_buffers = 256MB" "effective_cache_size = 768MB" \
  "work_mem = 8MB" "maintenance_work_mem = 64MB" "max_connections = 50" "timezone = 'UTC'" \
  > "/etc/postgresql/$PGVER/main/conf.d/bungee.conf"
systemctl restart postgresql
psql_root() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qtAc "$1"; }

if [ ! -f "$ENV" ]; then
  DBPASS=$(openssl rand -hex 24)
  if [ "$(psql_root "SELECT 1 FROM pg_roles WHERE rolname='bungee'")" = "1" ]; then
    psql_root "ALTER ROLE bungee LOGIN PASSWORD '$DBPASS'"
  else
    psql_root "CREATE ROLE bungee LOGIN PASSWORD '$DBPASS'"
  fi
  if [ "$(psql_root "SELECT 1 FROM pg_database WHERE datname='bungeefly'")" != "1" ]; then
    psql_root "CREATE DATABASE bungeefly OWNER bungee ENCODING 'UTF8' TEMPLATE template0"
  fi
  OWNER_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-16)
  umask 027
  {
    echo "NODE_ENV=production"
    echo "HOSTNAME=127.0.0.1"
    echo "PORT=3000"
    echo "NEXT_TELEMETRY_DISABLED=1"
    echo "DATABASE_URL=postgres://bungee:$DBPASS@127.0.0.1:5432/bungeefly"
    echo "DB_POOL_MAX=10"
    echo "BETTER_AUTH_URL=https://$HOST"
    echo "NEXT_PUBLIC_SITE_URL=https://$HOST"
    echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
    echo "SETTINGS_ENCRYPTION_KEY=$(openssl rand -hex 32)"
    echo "CRON_SECRET=$(openssl rand -hex 24)"
    echo "ADMIN_EMAILS="
    echo "SEED_SAMPLE_DATA=1"
    echo "OWNER_EMAIL=owner@bungeefly.local"
    echo "OWNER_PASSWORD=$OWNER_PASSWORD"
  } > "$ENV"
  chown root:bungee "$ENV" && chmod 640 "$ENV"
  echo "NEW_OWNER_PASSWORD=$OWNER_PASSWORD"
fi

echo "== app service"
cat > /etc/systemd/system/bungee-fly.service <<'UNIT'
[Unit]
Description=Bungee Fly (website, staff desk, background jobs)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=bungee
Group=bungee
WorkingDirectory=/srv/bungee-fly/current
EnvironmentFile=/etc/bungee-fly/env
Environment=NODE_OPTIONS=--max-old-space-size=768
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q bungee-fly

echo "== daily database backup (03:15 UTC, kept 14 days, on this server)"
cat > /etc/cron.d/bungee-fly-backup <<'CRON'
15 3 * * * postgres pg_dump -Fc bungeefly > /var/backups/bungee-fly/bungeefly-$(date +\%F).dump && find /var/backups/bungee-fly -name '*.dump' -mtime +14 -delete
CRON

echo "== nginx"
rm -f /etc/nginx/sites-enabled/default
cat > /etc/nginx/sites-available/00-default <<NGX
# Unknown hostnames (old DNS records still pointing here) get nothing.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_reject_handshake on;
}
# Visitors typing the bare IP go to the site.
server {
    listen 80;
    server_name $IP;
    return 301 https://$HOST\$request_uri;
}
NGX
if [ ! -f /etc/nginx/sites-available/bungee-fly ]; then
cat > /etc/nginx/sites-available/bungee-fly <<NGX
upstream bungee_app {
    server 127.0.0.1:3000;
    keepalive 16;
}
server {
    listen 80;
    listen [::]:80;
    server_name $HOST;
    client_max_body_size 50m;
    location / {
        proxy_pass http://bungee_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port \$server_port;
        proxy_set_header Connection "";
        proxy_read_timeout 120s;
    }
}
NGX
fi
ln -sf /etc/nginx/sites-available/00-default /etc/nginx/sites-enabled/00-default
ln -sf /etc/nginx/sites-available/bungee-fly /etc/nginx/sites-enabled/bungee-fly
sed -i 's/^\s*#\?\s*server_tokens.*/\tserver_tokens off;/' /etc/nginx/nginx.conf
nginx -t && systemctl reload nginx

echo "== HTTPS (Let's Encrypt, renews automatically)"
if certbot --nginx -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
  echo "HTTPS_OK"
else
  echo "HTTPS_FAILED: falling back to plain http for now"
  sed -i "s#^BETTER_AUTH_URL=https://#BETTER_AUTH_URL=http://#; s#^NEXT_PUBLIC_SITE_URL=https://#NEXT_PUBLIC_SITE_URL=http://#" "$ENV"
  sed -i "s#return 301 https://$HOST#return 301 http://$HOST#" /etc/nginx/sites-available/00-default
  nginx -t && systemctl reload nginx
fi
systemctl list-timers certbot.timer --no-pager | head -3 || true
echo "SETUP_DONE"
