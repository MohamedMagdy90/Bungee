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
- [ ] R-1 request.ts merges pay.* (+ staff.*); add checkout.buy/bookAndPay/bookAndPayNote; buy links on packages board
- [ ] R-4 checkout + order pages, SkipCash webhook route (orders.ts passes the webhook URL; check path)
- [ ] R-5 Admin: staff.*.json, admin layout/pages, orders desk, integrations form, admin orders/integrations APIs
- [ ] Security: bungee-fly.zip in the public repo contains .env.local (SkipCash sandbox keys + preview admin pw)
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
- [ ] R9 Shop for stockable retail items (per-branch stock tracking)
- [ ] R10 Session inventory: each booking deducts from purchased sessions (credits + ledger, visible balance)
- [ ] R11 Multiple branches (pricing, schedule, stock, staff scope)
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
