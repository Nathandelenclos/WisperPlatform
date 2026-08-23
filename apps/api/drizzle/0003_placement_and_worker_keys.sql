CREATE TABLE "worker_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"label" text NOT NULL,
	"secret_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "worker_keys_secret_fingerprint_unique" UNIQUE("secret_fingerprint")
);
--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "placement" text DEFAULT 'service' NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_keys" ADD CONSTRAINT "worker_keys_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worker_keys_owner_id_created_at_idx" ON "worker_keys" USING btree ("owner_id","created_at" DESC NULLS LAST);