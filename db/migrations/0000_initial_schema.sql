CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"ok" boolean NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "code_attempts" (
	"client_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "code_attempts_client_key_window_start_pk" PRIMARY KEY("client_key","window_start")
);
--> statement-breakpoint
CREATE TABLE "investigations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"run_id" uuid NOT NULL,
	"question" text,
	"snapshot" jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "investigations_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "run_samples" (
	"run_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"month" text NOT NULL,
	"status" text NOT NULL,
	"granule_id" text,
	"granule_title" text,
	"opendap_url" text,
	"values" jsonb,
	"bytes" integer,
	"duration_ms" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"fetched_at" timestamp with time zone,
	CONSTRAINT "run_samples_run_id_collection_month_pk" PRIMARY KEY("run_id","collection","month")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"question" text,
	"selection" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"client_key" text,
	"parent_run_id" uuid,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" jsonb,
	"result" jsonb,
	"explanation" jsonb,
	CONSTRAINT "runs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_samples" ADD CONSTRAINT "run_samples_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "run_samples_status_idx" ON "run_samples" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "runs_status_lease_idx" ON "runs" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "runs_client_created_idx" ON "runs" USING btree ("client_key","created_at");