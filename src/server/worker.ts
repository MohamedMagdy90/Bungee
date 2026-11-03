import "server-only";
import { releaseExpiredHolds } from "./booking/engine";
import { getDb } from "./db";
import { processOutbox } from "./mail/outbox";
import { expireStaleOrders } from "./payments/orders";

/** One pass of background jobs: send emails, release unpaid holds, lapse stale orders. Also run by /api/cron. */
export async function runJobs() {
  const db = await getDb();
  const released = await releaseExpiredHolds(db).catch((e) => (console.warn("[worker] holds", e), 0));
  const expired = await expireStaleOrders(db).catch((e) => (console.warn("[worker] orders", e), 0));
  const mail = await processOutbox(db).catch((e) => (console.warn("[worker] mail", e), null));
  return { released, expired, mail };
}

const g = globalThis as unknown as { __bfWorker?: ReturnType<typeof setInterval> };

/** Long-running server (DigitalOcean container, local dev): every minute. Serverless relies on /api/cron. */
export function startWorker() {
  if (g.__bfWorker) return;
  g.__bfWorker = setInterval(() => {
    runJobs().catch((e) => console.warn("[worker] run failed", e));
  }, 60_000);
  g.__bfWorker.unref?.();
}
