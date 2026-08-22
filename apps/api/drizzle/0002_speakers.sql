CREATE TABLE "transcription_speakers" (
	"transcription_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"name" text,
	CONSTRAINT "transcription_speakers_pkey" PRIMARY KEY("transcription_id","index")
);
--> statement-breakpoint
ALTER TABLE "transcription_segments" ADD COLUMN "speaker_index" integer;--> statement-breakpoint
ALTER TABLE "transcription_speakers" ADD CONSTRAINT "transcription_speakers_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE cascade ON UPDATE no action;