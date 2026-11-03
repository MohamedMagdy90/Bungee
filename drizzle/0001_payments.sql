ALTER TABLE "orders" ADD COLUMN "payment_method" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "recorded_by" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;