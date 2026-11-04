CREATE TABLE "media_files" (
	"media_id" uuid NOT NULL,
	"variant" text DEFAULT 'original' NOT NULL,
	"mime_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_files_media_id_variant_pk" PRIMARY KEY("media_id","variant")
);
--> statement-breakpoint
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;