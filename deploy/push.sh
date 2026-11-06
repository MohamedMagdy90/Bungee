#!/usr/bin/env bash
# Run from the workspace. Uses the deploy key in .deploy/ (never committed) and the pinned server ID.
#   bash deploy/push.sh            upload the code and start the release (background, log /root/release.log)
#   bash deploy/push.sh run 'cmd'  run one command on the server
set -euo pipefail
cd "$(dirname "$0")/.."
SERVER=${SERVER:-142.93.222.165}
chmod 700 .deploy && chmod 600 .deploy/id_ed25519
SSH=(ssh -i .deploy/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15
  -o ServerAliveInterval=30 -o UserKnownHostsFile=.deploy/known_hosts -o StrictHostKeyChecking=yes "root@$SERVER")

if [ "${1:-}" = "run" ]; then
  exec "${SSH[@]}" "$2"
fi

echo "== upload"
tar czf - --exclude=./node_modules --exclude=./.next --exclude=./.data --exclude=./.deploy --exclude='./.env*' \
  --exclude=./.git --exclude=./.same --exclude=./.backup --exclude=./Archive.zip --exclude=./dist --exclude=./uploads --exclude=./.tmp-tests . \
  | "${SSH[@]}" 'rm -rf /srv/bungee-fly/build/src && mkdir -p /srv/bungee-fly/build/src && tar xzf - -C /srv/bungee-fly/build/src'
echo "== release (runs on the server in the background; check with: bash deploy/push.sh run 'tail /root/release.log')"
"${SSH[@]}" 'nohup bash /srv/bungee-fly/build/src/deploy/release.sh > /root/release.log 2>&1 < /dev/null & echo started'
