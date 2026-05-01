import { pgTable, uuid, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { organizations } from "./organizations.js";
import { agents } from "./agents.js";

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    isManager: boolean("is_manager").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueMembershipIdx: uniqueIndex("organization_members_unique_idx").on(
      table.companyId,
      table.organizationId,
      table.agentId,
    ),
    byOrgIdx: index("organization_members_by_org_idx").on(table.companyId, table.organizationId),
    byAgentIdx: index("organization_members_by_agent_idx").on(table.companyId, table.agentId),
  }),
);

