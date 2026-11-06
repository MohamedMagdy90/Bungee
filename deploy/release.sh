#!/usr/bin/env bash
# Build and switch to a new release. Run as root on the server after push.sh uploads the code
# to /srv/bungee-fly/build/src. On a failed health check it switches back to the previous release.
set -euo pipefail
APP=/srv/bungee-fly
SRC=$APP/build/src
ENV=/etc/bungee-fly/env
REL=$APP/releases/$(date -u +%Y%m%d-%H%M%S)
PREV=$(readlink -f "$APP/current" 2>/dev/null || true)
chown -R bungee:bungee "$SRC"
as_app() { runuser -u bungee -- bash -c "set -eo pipefail; cd '$SRC' && $1"; }
# A failed step must not leave a half-built release folder behind.
trap 'status=$?; if [ $status -ne 0 ] && [ "$(readlink -f "$APP/current" 2>/dev/null)" != "$REL" ]; then rm -rf "$REL"; fi' EXIT
with_env="set -a && . '$ENV' && set +a"

echo "== install packages"
as_app "bun install --frozen-lockfile 2>&1 | tail -2"

echo "== database: migrations, sample data (first run), owner login"
as_app "bun run build:scripts >/dev/null && $with_env && node dist/setup.mjs"
# The owner password is only needed to create the login once: don't leave it lying around.
sed -i '/^OWNER_PASSWORD=/d' "$ENV"

echo "== build (takes a few minutes on this machine)"
as_app "$with_env && export NODE_OPTIONS=--max-old-space-size=1536 && ./node_modules/.bin/next build 2>&1 | tail -25"

echo "== assemble $REL"
mkdir -p "$REL/.next"
cp -a "$SRC/.next/standalone/." "$REL/"
cp -a "$SRC/.next/static" "$REL/.next/static"
rm -rf "$REL/public" "$REL/drizzle" && cp -a "$SRC/public" "$SRC/drizzle" "$SRC/dist" "$REL/"
rm -f "$REL"/.env*
chown -R bungee:bungee "$REL"

echo "== switch + restart"
ln -sfn "$REL" "$APP/current"
systemctl restart bungee-fly
ok=0
for _ in $(seq 1 45); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/api/health; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "RELEASE_FAILED: health check did not pass"
  journalctl -u bungee-fly -n 40 --no-pager || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    ln -sfn "$PREV" "$APP/current" && systemctl restart bungee-fly && echo "rolled back to $PREV"
  fi
  exit 1
fi

echo "== keep the last 3 releases"
ls -1dt "$APP"/releases/*/ | tail -n +4 | xargs -r rm -rf
echo "RELEASE_OK $REL"
