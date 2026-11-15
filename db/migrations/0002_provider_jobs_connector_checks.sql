CREATE TABLE "connector_checks" (
	"connector" text PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"value" double precision,
	"units" text,
	"label" text,
	"detail" jsonb,
	"run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "provider_jobs" (
	"run_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"job_key" text NOT NULL,
	"provider" text NOT NULL,
	"job_ref" text,
	"status" text NOT NULL,
	"request" jsonb,
	"meta" jsonb,
	"message" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"checks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "provider_jobs_run_id_collection_job_key_pk" PRIMARY KEY("run_id","collection","job_key")
);
--> statement-breakpoint
ALTER TABLE "run_samples" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "provider_jobs" ADD CONSTRAINT "provider_jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_jobs_status_idx" ON "provider_jobs" USING btree ("status","next_check_at");