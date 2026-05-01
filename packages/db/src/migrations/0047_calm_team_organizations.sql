CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "name" text NOT NULL,
  "level" text NOT NULL,
  "parent_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "company_id" uuid;

--> statement-breakpoint
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "name" text;

--> statement-breakpoint
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "level" text;

--> statement-breakpoint
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "parent_id" uuid;

--> statement-breakpoint
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now();

--> statement-breakpoint
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now();

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_company_level_idx" ON "organizations" ("company_id","level");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_company_parent_idx" ON "organizations" ("company_id","parent_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "is_manager" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "company_id" uuid;

--> statement-breakpoint
ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "organization_id" uuid;

--> statement-breakpoint
ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "agent_id" uuid;

--> statement-breakpoint
ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "is_manager" boolean DEFAULT false;

--> statement-breakpoint
ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now();

--> statement-breakpoint
ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now();

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_unique_idx" ON "organization_members" ("company_id","organization_id","agent_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_members_by_org_idx" ON "organization_members" ("company_id","organization_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_members_by_agent_idx" ON "organization_members" ("company_id","agent_id");

