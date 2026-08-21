#!/usr/bin/env bash
# Provision a fresh Ubuntu 22.04/24.04 droplet. Run as root:
#   bash setup.sh agent.example.com https://github.com/mr-Rav-an/voice_ai.git
set -euo pipefail

DOMAIN="${1:?usage: setup.sh <domain> [repo-url]}"
REPO="${2:-https://github.com/mr-Rav-an/voice_ai.git}"
APP=/opt/steelman

echo "==> System packages"
apt-get update -qq
apt-get install -y -qq curl git ufw debian-keyring debian-archive-keyring apt-transport-https

echo "==> Node 22"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi

echo "==> App user and code"
id -u steelman >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin steelman
mkdir -p "$APP" /var/log/steelman /var/log/caddy
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch --quiet origin && git -C "$APP" reset --hard --quiet origin/main
else
  git clone --quiet "$REPO" "$APP"
fi
cd "$APP"
npm install --omit=dev --no-audit --no-fund
mkdir -p "$APP/data"
chown -R steelman:steelman "$APP" /var/log/steelman

if [ ! -f "$APP/.env" ]; then
  cp "$APP/.env.example" "$APP/.env"
  echo "!! Wrote a blank $APP/.env — fill it in before starting."
fi
chmod 600 "$APP/.env"
chown steelman:steelman "$APP/.env"

echo "==> Caddy site"
sed "s/agent.example.com/$DOMAIN/" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "==> systemd service"
cp "$APP/deploy/steelman-agent.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now steelman-agent

echo "==> Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80,443/tcp >/dev/null
ufw --force enable >/dev/null

echo
echo "Done. Next:"
echo "  1. Fill in $APP/.env      (then: systemctl restart steelman-agent)"
echo "  2. Dashboard:  https://$DOMAIN"
echo "  3. Voicebot applet URL:"
echo "     wss://$DOMAIN/exotel-stream/<EXOTEL_STREAM_SECRET>"
echo "  4. Logs:  journalctl -u steelman-agent -f"
