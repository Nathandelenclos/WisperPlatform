CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_issuer_account_id_unique" UNIQUE("issuer","account_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "transcription_segments" (
	"transcription_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"text" text NOT NULL,
	"corrected" boolean DEFAULT false NOT NULL,
	CONSTRAINT "transcription_segments_pkey" PRIMARY KEY("transcription_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "transcriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"language" text NOT NULL,
	"media_storage_key" text NOT NULL,
	"media_original_name" text NOT NULL,
	"media_content_type" text NOT NULL,
	"media_byte_size" bigint NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"current_run_id" uuid,
	"claimed_by" text,
	"lease_expires_at" timestamp with time zone,
	"last_applied_batch_sequence" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"requested_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"reserved_at" timestamp with time zone,
	"reserved_by" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_segments" ADD CONSTRAINT "transcription_segments_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transcriptions_status_requested_at_idx" ON "transcriptions" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "transcriptions_owner_id_requested_at_idx" ON "transcriptions" USING btree ("owner_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transcriptions_status_lease_expires_at_idx" ON "transcriptions" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");