#!/usr/bin/env bash
#
# One-shot server setup for the AI Opportunity Assessment tool.
# Designed for a fresh Ubuntu 22.04/24.04 instance (Oracle Cloud Always Free
# ARM recommended: Ampere A1, >= 4GB RAM so `npm run build` doesn't OOM).
#
# Installs: Node 22, the app (from GitHub), systemd service, Caddy (automatic
# HTTPS via Let's Encrypt), and a DuckDNS update cron.
#
# Usage (as root or with sudo):
#   curl -fsSL https://raw.githubusercontent.com/Ellan1989/ai-assessment/main/scripts/setup-server.sh \
#     | sudo bash -s -- --domain myapp.duckdns.org --duckdns-token XXX \
#          --admin-email you@example.com --admin-password 'Str0ngPass!' \
#          [--app-secret ...] [--repo https://github.com/Ellan1989/ai-assessment.git]
#
# Ports 80 and 443 must be open in the cloud firewall/security list first.

set -euo pipefail

DOMAIN="" DUCKDNS_TOKEN="" ADMIN_EMAIL="" ADMIN_PASSWORD="" APP_SECRET="" REPO="https://github.com/Ellan1989/ai-assessment.git"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --duckdns-token) DUCKDNS_TOKEN="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="$2"; shift 2 ;;
    --app-secret) APP_SECRET="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done
for v in DOMAIN DUCKDNS_TOKEN ADMIN_EMAIL ADMIN_PASSWORD; do
  if [[ -z "${!v}" ]]; then echo "Missing required --$(echo "$v" | tr 'A-Z_' 'a-z-')"; exit 1; fi
done
[[ -z "$APP_SECRET" ]] && APP_SECRET="$(head -c32 /dev/urandom | xxd -p -c64)"

APP_DIR=/opt/ai-assessment
BASE_URL="https://${DOMAIN}"

echo "==> Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg ufw

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> App code"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --all && git -C "$APP_DIR" reset --hard origin/main
else
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci
npm run build

echo "==> Environment"
mkdir -p "$APP_DIR/.data"
cat > "$APP_DIR/.env.local" <<EOF
APP_BASE_URL=$BASE_URL
DATABASE_PATH=$APP_DIR/.data/app.db
APP_SECRET=$APP_SECRET
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
ASSESSMENT_TTL_DAYS=7
REPORT_TTL_DAYS=30
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=
EMAIL_PROVIDER=console
EOF
chmod 600 "$APP_DIR/.env.local"

echo "==> systemd service (auto-start on boot, restart on crash)"
cat > /etc/systemd/system/ai-assessment.service <<EOF
[Unit]
Description=AI Opportunity Assessment
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(command -v npm) start
Environment=NODE_ENV=production
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now ai-assessment

echo "==> Caddy (automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y && apt-get install -y caddy
fi
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
}
EOF
systemctl restart caddy
systemctl enable caddy

echo "==> DuckDNS keep-alive (every 5 minutes)"
CRON="*/5 * * * * curl -fsS 'https://www.duckdns.org/update?domains=${DOMAIN%%.*}&token=${DUCKDNS_TOKEN}&ip=' >/dev/null"
( crontab -l 2>/dev/null | grep -v duckdns ; echo "$CRON" ) | crontab -

echo "==> Firewall"
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
yes | ufw enable || true

echo ""
echo "ALL DONE."
echo "  Site:      $BASE_URL"
echo "  Admin:     $BASE_URL/admin/login ($ADMIN_EMAIL)"
echo "  Data:      $APP_DIR/.data  (back this up)"
echo "  First HTTPS certificate is issued on first visit — open $BASE_URL once."
echo "  Update later: re-run this same script (it pulls latest main and rebuilds)."
