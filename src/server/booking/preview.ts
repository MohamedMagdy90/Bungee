import "server-only";
import { and, eq, inArray, like } from "drizzle-orm";
import type { Database } from "../db";
import { creditLedger, customerPackages, products, users } from "../db/schema";
import { isPreviewMode } from "../runtime";

const PREVIEW_NOTE = "Preview credits (sample data, no payment)";
const PREVIEW_PACKS = ["adult-10", "kids-8", "private-1"];

/**
 * Preview builds only: gives a test account the packs it needs to try booking before payments exist
 * (Phase 4). Idempotent per pack. Never available on the production deployment.
 */
export async function grantPreviewCredits(db: Database, userId: string, branchId: string | null) {
  if (!isPreviewMode()) throw new Error("Preview credits are disabled in production.");
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!user) throw new Error("User not found");
    const catalogue = await tx.select().from(products).where(inArray(products.slug, PREVIEW_PACKS));
    const existing = await tx
      .select({ productId: customerPackages.productId })
      .from(customerPackages)
      .innerJoin(creditLedger, eq(creditLedger.customerPackageId, customerPackages.id))
      .where(and(eq(customerPackages.userId, userId), like(creditLedger.note, "Preview credits%")));
    const had = new Set(existing.map((e) => e.productId));
    let granted = 0;
    for (const p of catalogue) {
      if (had.has(p.id) || !p.credits) continue;
      const now = new Date();
      const [pkg] = await tx
        .insert(customerPackages)
        .values({
          userId,
          productId: p.id,
          branchId,
          creditsTotal: p.credits,
          creditsRemaining: p.credits,
          startsAt: now,
          expiresAt: new Date(now.getTime() + (p.validityDays ?? 30) * 86_400_000),
        })
        .returning({ id: customerPackages.id });
      await tx.insert(creditLedger).values({
        userId,
        customerPackageId: pkg.id,
        delta: p.credits,
        balanceAfter: p.credits,
        reason: "admin_adjust",
        note: PREVIEW_NOTE,
      });
      granted += 1;
    }
    return granted;
  });
}
