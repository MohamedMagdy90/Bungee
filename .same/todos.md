# Bungee Fly — Todos

## Decisions (locked)
- Default language: English (`/en`), Arabic (`/ar`) mirrored RTL, Western numerals in both
- Auth: email + password (verification, reset) — Better Auth
- Payments: SkipCash (hosted pay URL + verified webhook, idempotent)
- Hosting: DigitalOcean (App Platform container + Managed Postgres + Spaces CDN)
- Orange: #FF642E (from master artwork; guideline HEX #FF4C00 is a typo)
- Display type: IBM Plex SemiBold (as the brand book sets its own statements). Kotech only in the logo (licensed; its G/S/I/digits misread in running words)
- Logos: vector SVGs extracted from the master .ai file
- Local dev DB: PGlite (self-heals if corrupted); prod: node-postgres → DO Managed PG

## Recovery after workspace wipe (Version 3 restore did not include bungee-fly)
- [x] Deps + Python asset toolchain
- [x] Assets: logo SVG/TS, placeholder webp, app icons, fonts woff2
- [x] Config: next.config, tailwind tokens, globals.css, i18n routing + messages
- [x] Data layer: schema (all phases), migrations, db client, seed, materialize
- [x] Components: brand, ui/button, site chrome, homepage sections
- [x] Layout, page, manifest, /api/health
- [x] Verify EN + AR + mobile visually, lint, version (v6/v7)
- [x] Fixes: tailwind-merge custom font-size group (button text colour), varied "Next up"
- [x] Public preview on Netlify: https://same-rapolkm560t-latest.netlify.app (in-memory sample DB, BF_DEMO_DB)
  - Gotcha: the deploy upload drops `next.config.js` -> config lives in `next.config.mjs`; build guarded by `test -f`
- [ ] DigitalOcean: Dockerfile, .do/app.yaml (migrate script done)
- [ ] Back up to a private GitHub repo (ask user first)
## Screenshot tooling (non-persistent; reinstall after wipes)
- pip install --user --break-system-packages playwright pillow; playwright install --only-shell chromium
- dpkg -x bungee-brief/.libs/debs/*.deb ~/chromelibs; LD_LIBRARY_PATH=~/chromelibs/usr/lib/aarch64-linux-gnu
- python3 bungee-brief/scripts/shot.py /en out.png 1440 900 [full]

## Recovery #2 (Nov 3) — rebuilt from two zips on GitHub (MohamedMagdy90/Bungee, PUBLIC repo)
- bungee-fly.zip (newest): all src/ incl. payments; lacked 6-segment app/ routes. Archive.zip (V19-era) supplied them.
- Prefer shallow app/ paths for new routes (6-segment app files went missing once); flat app/api/<name>/route.ts.
- [x] R-2 Restored APIs: auth/[...all], booking/cancel, booking/context, me/children, me/preview-credits (V23)
- [x] R-3 Restored pages: sign-in, sign-up, forgot-password, reset-password, account, ticket, mailbox (V23)
- [x] R-1 request.ts merges pay.* + staff.*; checkout copy; buy links on packages board (ccbb768)
- [x] R-4 checkout + order pages, SkipCash webhook route (eb21d70)
- [x] R-5 Admin: staff.*.json (cc46b7f), admin APIs (6c2bb99), shell + gate + orders desk (af0428e), integrations (6dcc7da)
  - Routes: /admin -> /admin/orders (?view=&q=&id= ; desk QR on the order page deep-links ?id=), /admin/integrations
  - Access: staffGate(area) per page (signed out -> sign-in?next=…; customer/coach -> <Denied/>); layout only shows the rail
  - Preview owner: PREVIEW_ADMIN_EMAIL / PREVIEW_ADMIN_PASSWORD in .env.local (seeded on boot)
- [x] GitHub backup: AmrDNAERP has write access; source pushed as real files (commit e0e4b7b on main)
  - Push after EVERY batch: git add --ignore-removal . && git commit, then push with the token in the URL (the credential
    helper can hang on a Username prompt): T=$(gh auth token); GIT_TERMINAL_PROMPT=0 timeout 70 git push -q
    "https://x-access-token:$T@github.com/MohamedMagdy90/Bungee.git" main   (never echo $T)
  - Restarts can also log gh out (~/.config/gh gone): ask the user to reconnect; GitHub MCP may be down too
  - A restart rolls files back to the last VERSION and deletes ~150 tracked files: after reattaching .git run
    git ls-files -dz | xargs -0 -r git checkout --   then re-apply anything not yet pushed
  - Restore after a wipe: git clone https://github.com/MohamedMagdy90/Bungee.git bungee-fly && cd bungee-fly && bun install,
    then recreate .env.local (never committed). Archive.zip in the repo is the user's upload: leave it alone.
    .env.local recovery: git show 1a068f7^:bungee-fly.zip > /tmp/o.zip && unzip -p /tmp/o.zip bungee-fly/.env.local > .env.local
  - Partial wipe (files kept, .git emptied): git clone --no-checkout <repo> /tmp/g && mv /tmp/g/.git . && git reset -q
  - No git identity on fresh hosts: pass GIT_AUTHOR_/GIT_COMMITTER_ NAME/EMAIL from `git log -1` per command (never git config)
  - GitHub push sometimes returns 500: retry loop in background (for i in 1 2 3 4; do push && break; sleep 15; done)
  - Wipes happen MID-BATCH: commit + push after every 1-2 files, not at the end of a batch
  - Python urllib won't resend Better Auth's Secure cookie over http://localhost: carry the Cookie header by hand in tests
- [ ] Security: bungee-fly.zip (deleted, still in history) had .env.local; repo still PUBLIC -> make private + rotate sandbox keys
## Phase 1 — Public website (after recovery)
- [ ] Timetable page, Programmes, Packages, Studios (branch pages), Coaches, FAQ, Contact
## Client requirements (Nov 2) — ALL must be covered
- [x] R1 Private classes never overlap group classes at the same branch (DB exclusion constraint + materialize skip; verified)
- [ ] R2 Reservation confirmation (screen + email, EN/AR)
- [ ] R3 QR code with reservation details (confirmation + My bookings; signed link for front desk)
- [ ] R4 Reservation status linked to payment gateway confirmation (pending_payment hold -> booked / released)
- [ ] R5 Checkout: payment success / failure / pending very clear
- [ ] R6 Arabic everywhere (screens, emails, invoices)
- [ ] R7 Invoice emailed automatically after payment; email verification REQUIRED at sign-up
- [ ] R8 Admin registers walk-in customers without email verification (phone-only allowed)
- [x] R9 Shop for stockable retail items (per-branch stock tracking) — Nov 6:
  - Staff: Studio > Packs & shop (/admin/products, area "catalog" = manager/owner): packs, extensions, services, shop items;
    standard + per-studio prices; stock per studio (received/returned/remove/count/move), warn-at level, history; overview low-stock
  - Customer: homepage section 05 Shop (#shop, header link), collect-at studio switcher, checkout Pick-up row
  - Desk: paid shop lines "To collect" -> Mark handed over (order_items.fulfilled_at); order page shows collect note + desk QR
  - Not yet: refunds (no refund flow exists at all; returns are a manual "Returned" stock entry),
    front desk can't receive stock (catalog is manager/owner only)
- [x] Real shop (Nov 6, after "very weak shop" feedback):
  - DB: product_categories (aisles), product_media (gallery), products.category_id (migration 0003); seed-shop.ts adds
    5 aisles + 21 sample items once (gated like the main seed; runs on setup and PGlite boot)
  - Public: /shop (search EN/AR + SKU, aisle, sort, in-stock at studio, 24/page, all in SQL), /shop/[slug] (gallery,
    stock per studio, qty, add / buy now, related), /cart, /checkout?cart=1. Header cart badge (window event bf:cart)
  - Cart: carts/cart_items tables; guest cart by http-only cookie bf_cart, account cart by user; merge at sign-in
    (src/server/shop/cart.ts). createCartCheckout = one order, one line per item, re-checks price/stock, empties cart
  - Staff: shop list paged in SQL (40/page) with search + filters (low/out/hidden/no aisle), Aisles tab, aisle +
    gallery on items, CSV import (dry run first; match by SKU then slug; empty cell keeps, "-" clears; stock:<studio>,
    price:<studio> columns; unknown aisles created) and export (Excel BOM). 300 rows import in ~7 s.
  - Gotcha: drizzle leaves columns unqualified in single-table selects -> correlated subqueries need explicit aliases
  - Next: variants (sizes/colours), desk "New order" with several items, refunds putting stock back
- [ ] R10 Session inventory: each booking deducts from purchased sessions (credits + ledger, visible balance)
- [ ] R11 Multiple branches (pricing, schedule, stock, staff scope)
## Team, access, schedule, role overviews (Nov 6, after user request)
- Roles: owner, admin (new enum value), manager (= Branch manager), front_desk, coach. Permission map in
  src/lib/permissions.ts (PERMISSIONS, groups, ROLE_DEFAULTS, ALL_STUDIO_ROLES). staff_access table (migration 0004):
  permissions[], all_branches, suspended_at, invited_at/by. getStaffContext() reads role/perms/studios/coach FRESH per
  request (cookie cache ignored) -> suspend/role change applies at once. staffGate(perm|perm[]|null) / requireStaff(...)
- Team & access (/admin/team, src/server/admin/team.ts, /api/admin/team): add/promote, role cards, coach link
  (required for coach), studios, per-person access with live menu preview, invite link (7-day Better Auth reset token,
  /reset-password?token=&invite=1 -> staff welcome -> /admin/sign-in), suspend/reactivate/remove; guards: owner-only for
  owners, no self change, grant only what you hold, last owner stays. Audit: team.*
- Schedule (/admin/schedule, /api/admin/schedule): week/day, studio + coach filters, roster (first visit, child of,
  walk-in, pay pending), check-in / undo / no-show, waitlist, 60 s refresh. Coach = own classes only.
- Overview by role (admin/page.tsx + src/server/admin/analytics.ts + components/admin/charts.tsx): business / studio /
  desk / coach; period 7/30/90; studio chips; KPIs vs previous period; revenue+bookings per day; fill heatmap;
  top classes / items; sales mix; studios + coaches tables; needs-attention (gated per permission). No menu cards.
- seed-history.ts (once, sample data only, marker in settings): 48 customers, real bookings 6 weeks back + 2 ahead,
  check-ins, no-shows, waitlists, pack + shop orders; booked_count recomputed from real rows
- [x] Deployed + tested live (Nov 6): roles.js 51/53 (2 = test counted "reports" as a menu item) + scope.js 8/8.
  Test accounts admin./manager./desk./coach.test@bungeefly.local (passwords in /root/.role-test-pass on the server);
  test scripts + Playwright in /opt/shots (shot.js, roles.js, scope.js). Better Auth sign-in limit 3/10 s: space sign-ins 11 s
- [x] Studio scope: orders (own + studio-less; detail/actions 404 elsewhere; New order own studios), timetable
  (scopeTimetable + studioOf guard), stock actions + low-stock level (own studio), locations (own, no new)
- [x] Audit fixes: plural places, "Pick one from the list"; hero /timetable already maps to #timetable (not a bug);
  same-runtime/react-grab scripts now dev-only (were on the live site)
- [ ] Next: walk the other admin screens (orders, customers, classes, products, website, media) per role, EN/AR/phone
## Open questions for client
- Email provider (Resend / Postmark / SES / SMTP)? SkipCash sandbox credentials? "Stackable" = stockable retail (assumed)
## Phase 2 — Customer app (in progress)
- [x] Better Auth instance + /api/auth route; booking engine (atomic book/waitlist/cancel/promote + ledger)
- [x] Require email verification at sign-up (R7); private/group overlap constraint (R1)
- [x] Booking API (context/book/cancel/children/preview-credits) — curl-tested: book, waitlist, duplicate, refund, CSRF
- [x] Schema prep: pending_payment hold, invoices, branch stock, walk-in flag (R4, R7, R8, R9)
- [ ] UI batch 1: auth client, member shell, sign in/up, forgot/reset (messages in messages/app.{en,ar}.json)
- [ ] UI batch 2: account page (balance R10, bookings + QR R3, children, ledger) + ticket page /r/[code]
- [ ] UI batch 3: session sheet booking flow + confirmation (R2) + header account link
- [ ] UI batch 4: email templates EN/AR + preview mailbox (/dev/mailbox?to=)
- Gotchas: restores roll back to last VERSION -> version after every batch; heredocs fail in bash
- RESTORE DEPTH LIMIT: restores silently drop files deeper than 6 path segments counted from bungee-fly
  (e.g. bungee-fly/app/api/me/children/route.ts = OK, one more folder = LOST). That is why app/ lives at the
  project root (not src/app) and the QR ticket is /ticket?c= (not /r/[code]). Check before adding nested routes:
  find . -mindepth 6 -type f -not -path "./node_modules/*" -not -path "./.next/*" -not -path "./.data/*"
- [x] UI batch 1 (auth pages) · [x] UI batch 2 (account + ticket) · [x] UI batch 3 (sheet booking + header link)
## Staff back office (Nov 4) — grouped desk, one map in src/components/admin/sections.ts
- [x] Staff sign-in page (/admin/sign-in) + "Studio staff?" link; staffGate sends signed-out to it
- [x] Access by role (staff.ts AREA_ROLES): front desk = orders + customers; manager/owner = everything
- [x] Shared kit (kit.tsx), copy in messages/manage.{en,ar}.json ("manage" namespace)
- [x] Images & videos (media_files bytea table, /api/media?id= with ranges), picker used by every editor
- [x] Locations, Classes & coaches, Homepage & FAQs (+ public FAQ section 07), Timetable, Customers
- [x] /admin overview (today band + section cards); Overview link in the menu
- [x] Runtime tests (Nov 5): timetable 11/11; customers real flow 25/25 (sign up -> verify -> credits -> book;
      desk search/profile/adjust/cancel; studio cancels class -> refund + email with reason; AR pages);
      homepage FAQ add -> shows on /en and /ar; pages EN+AR: overview, timetable, customers, website, locations
  - Fixed: phone search compared digits to formatted phones (b9b61c6)
- [ ] Re-check /admin/classes + /admin/media pages after the restarts (OOM at 3 GB dev server mid-run)
- [ ] Version + deploy
## Deploy (Nov 6) — self-hosted on the user's Droplet, NO DigitalOcean services
- Droplet 142.93.222.165 (2 vCPU / 2 GB), rebuilt to Ubuntu 24.04 (old Zentra test server wiped on user's order)
- Server ID (pinned in .deploy/known_hosts): SHA256:e+xSWCk//TUHHQZqhd2j/AU3eMsgUNFyl5hz55LHRTo
- Access: key in bungee-fly/.deploy/ (gitignored; snapshotted by versions). If lost: new key + user pastes line in
  Web Console (sed -i '/same-deploy-bungeefly/d' first, so dead keys don't pile up)
- Workspace is aarch64, server x86_64 -> build ON the server (deploy/push.sh uploads tar over ssh; no git needed)
- deploy/server-setup.sh <host> <ip> (once): swap 4G, ufw, fail2ban, Node 22, Bun, PostgreSQL 16 local only,
  /etc/bungee-fly/env (secrets generated on the server), systemd bungee-fly, nginx + certbot, daily pg_dump
- deploy/release.sh: bun install -> dist/setup.mjs (migrate + SEED_SAMPLE_DATA + OWNER_EMAIL/PASSWORD) ->
  next build (env sourced: NEXT_PUBLIC_SITE_URL is inlined) -> releases/<ts> -> current symlink -> health/rollback
- No domain yet: https://142-93-222-165.sslip.io (fallback http). No Resend yet: emails queue in the outbox.
  Owner login owner@bungeefly.local (password printed once by server-setup). Wipe sample data before launch.
- [x] LIVE (Nov 6): https://142-93-222-165.sslip.io — setup + release done, HTTPS OK, sample data, owner login,
      SkipCash sandbox keys in /etc/bungee-fly/env. Smoke test: owner sign-in + 18 staff pages EN/AR all 200.
  - Deploy again: bash deploy/push.sh (background; poll `bash deploy/push.sh run 'tail /root/release.log'`,
    sleeps <= 80 s per call: the bash tool times out at 90 s without output). Build ~4 min on the droplet.
  - Owner password: /root/.owner-pass on the server (root only) until the user changes it; then delete that file
  - Fixed: Next standalone sees localhost:3000 as its origin -> middleware rewrites locale redirects to the
    public host; nginx also sends X-Forwarded-Host/Port. No `bunx` on the server: use ./node_modules/.bin
- [ ] Rotate SkipCash sandbox keys + make repo private; then domain, Resend, live SkipCash, webhook URL
- [x] Desk "New order" (Nov 5): Orders > New order (or Customer profile > New order = ?new=1&customer=):
      find customer or register walk-in -> studio (remembered per device) -> pack / service / shop item ->
      order opens in the normal panel (SkipCash QR or cash / card). createCheckout source:"admin" skips the
      customer-facing at-studio switch + "awaiting" email; audit order.create. Extensions not sold at the desk yet
      (need a pack picker). Walk-in placeholder emails hidden in desk, order page, invoice. Tested 17/17.
  - Prices are minor units (QAR x100): adult-10 at West Bay = 110000
- [ ] Media in production: DO Spaces driver (DB storage works everywhere but caps size; Netlify body limit 6 MB)
- [ ] Session materialisation in the worker (today: seed + timetable page load + slot saves)
- Gotcha: several string_replace calls on the SAME file back to back can silently drop earlier ones
- Gotcha: a `!` inside double quotes in bash triggers history expansion and kills the whole command line;
  use single quotes for grep patterns containing `!`
  -> one edit per file per step, or a python patch script; always grep to verify
- Gotcha: memory limit 4 GB; ship ~1.6 GB + dev server ~1 GB + tsc ~1.2 GB = restarts. Never run tsc with dev up.
- Nov 6: compiling admin routes in the local dev server (turbopack, >2 GB) restarted the workspace 3 times. Each restart
  empties .git and rolls EDITED files back to the last version (new files survive). So: don't run the dev server; test on
  the droplet (bash deploy/push.sh, then python tests against https://142-93-222-165.sslip.io); version after every batch.
  Git backup of local commits: git bundle -> /root/bungee-fly.bundle on the droplet (restore: git clone /root/... or scp back)

## Admin screen review (Nov 6 evening) — per role, EN/AR, phone (shots: /opt/shots, audit.sh / audit2.sh)
- [x] Orders: views Unpaid / Hand over (paid + retail item not handed over) / Paid / All; rows truncate; overview
      "shop items to hand over" links ?view=collect
- [x] Customers: profile lists full width (Section stack), 5 bookings + "Show all N"; list counts in customers
- [x] kit: MasterDetail grid-cols-[minmax(0,1fr)] (phone overflow), initials for missing photos, selectClass/selectStyle
      (chevron on the left in Arabic), NumberInput unit opposite the number in Arabic, Segmented tabs content-sized
- [x] Per-list counts (classes, coaches, studios, packs, aisles, shop items, questions); low stock in the shop row meta
- [ ] Verify retakes (audit2.sh) after deploy; full-page shots faded = entry animation (shot.js now freezes animations)
- Restart Nov 6 20:37: .git emptied + gh signed out + no git identity. Restored .git by cloning the public repo
  (https://github.com/MohamedMagdy90/Bungee.git); commit with GIT_AUTHOR_*/GIT_COMMITTER_* env (AmrDNAERP), never
  git config. Push needs the user to re-auth gh. Backup: git bundle -> /root/bungee-fly.bundle on the droplet.
- A dev server auto-started after the restart: kill it (pkill -f "next dev") before tsc/builds.
## Phase 3 — Admin
- [ ] Walk-in registration (R8), QR check-in (R3), branches/schedule/products/stock (R9, R11)
- [ ] Branches (locations, hours, map, gallery), media library uploads (Spaces presigned)
- [ ] Schedule templates + sessions, coaches, class types, products & prices per branch
- [ ] Customers, credits ledger, check-in, orders/refunds, banners, settings, staff roles
## Phase 4 — Payments + notifications (client: Resend, SkipCash sandbox creds given in chat Nov 3)
- Payment choice for customers: Online (SkipCash) OR Pay at studio. At the desk staff can: show a SkipCash QR
  (customer scans + pays), or mark paid (cash / card machine / other). Credentials entered in Admin > Integrations.
- SkipCash: POST {api}/api/v1/payments, Authorization = base64(HMACSHA256(keySecret, "Uid=..,KeyId=..,Amount=..,
  FirstName=..,LastName=..,Phone=..,Email=..[,TransactionId=..][,Custom1=..]")) non-empty fields only, in order.
  GET /api/v1/payments/{id} with Authorization: ClientID. statusId 0 new,1 pending,2 paid,3 cancelled,4 failed,
  5 rejected,6 refunded. Webhook sig: PaymentId,Amount,StatusId[,TransactionId][,Custom1],VisaId with webhook key.
  Refund POST /api/v1/payments/refund sig Id,KeyId[,Amount]. Sandbox https://skipcashtest.azurewebsites.net, live
  https://api.skipcash.app. Test card OK 5200 0000 0000 2151 10/28 237; fail 5200 0000 0000 2490 04/28 256.
  Sandbox creds live ONLY in .env.local (gitignored) / admin settings (encrypted). Never commit them.
- [ ] A server: schema (orders.payment_method, payments.recorded_by/note), integrations store (AES-GCM),
      skipcash client, Resend outbox sender, order emails, engine hold-for-payment, orders service, admin bootstrap
- [ ] B API: /api/checkout, /api/orders, /api/skipcash/webhook, /api/admin/integrations, /api/admin/orders, /api/cron
- [ ] C customer UI: /checkout, /order (success/failed/pending/at-studio + invoice), buy buttons, book & pay, account orders
- [ ] D admin UI: /admin (orders & payments desk, integrations tab), staff header link
- [ ] Outbox worker: emails, reminders, expiry, waitlist promotion, session materialisation
- [ ] Service worker + web push + install sheet
