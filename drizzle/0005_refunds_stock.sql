ALTER TABLE "refunds" ALTER COLUMN "payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "refunded_quantity" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "order_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "method" text DEFAULT 'skipcash' NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "restock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id","created_at");--> statement-breakpoint
-- New permissions reach people whose access was customised before they existed (null = role defaults, already covered).
-- Stock: anyone at the desk or in the shop catalogue (front desk, branch managers, administrators).
UPDATE "staff_access" SET "permissions" = array_append("permissions", 'stock'), "updated_at" = now()
WHERE "permissions" IS NOT NULL AND NOT ('stock' = ANY("permissions"))
  AND ('orders' = ANY("permissions") OR 'catalog' = ANY("permissions"))
  AND "user_id" IN (SELECT "id" FROM "users" WHERE "role"::text IN ('admin', 'manager', 'front_desk'));--> statement-breakpoint
-- Refunds: branch managers and administrators who already take payments.
UPDATE "staff_access" SET "permissions" = array_append("permissions", 'refunds'), "updated_at" = now()
WHERE "permissions" IS NOT NULL AND NOT ('refunds' = ANY("permissions")) AND 'orders' = ANY("permissions")
  AND "user_id" IN (SELECT "id" FROM "users" WHERE "role"::text IN ('admin', 'manager'));
