ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'admin' BEFORE 'owner';--> statement-breakpoint
CREATE TABLE "staff_access" (
	"user_id" text PRIMARY KEY NOT NULL,
	"permissions" text[],
	"all_branches" boolean DEFAULT false NOT NULL,
	"invited_by" text,
	"invited_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_access" ADD CONSTRAINT "staff_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_access" ADD CONSTRAINT "staff_access_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;