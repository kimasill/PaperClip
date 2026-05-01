ALTER TABLE "issues" ADD COLUMN "blocked_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "escalation_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "blocked_heartbeat_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_webhook_deliveries" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_webhook_deliveries" ADD COLUMN "next_retry_at" timestamp with time zone;