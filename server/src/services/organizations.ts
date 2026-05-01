import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, organizationMembers, organizations } from "@paperclipai/db";
import { notFound, unprocessable } from "../errors.js";

type OrgLevel = "department" | "team";

function asOrgLevel(value: unknown): OrgLevel {
  if (value === "department" || value === "team") return value;
  throw unprocessable("Invalid organization level");
}

export function organizationsService(db: Db) {
  return {
    list: async (companyId: string) => {
      return db.select().from(organizations).where(eq(organizations.companyId, companyId));
    },

    create: async (companyId: string, input: { name: string; level: OrgLevel; parentId?: string | null }) => {
      const name = input.name?.trim();
      if (!name) throw unprocessable("Organization name is required");
      const level = asOrgLevel(input.level);
      const parentId = input.parentId ?? null;
      const created = await db
        .insert(organizations)
        .values({
          companyId,
          name,
          level,
          parentId,
        })
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!created) throw notFound("Failed to create organization");
      return created;
    },

    update: async (
      companyId: string,
      orgId: string,
      input: { name?: string; parentId?: string | null },
    ) => {
      const patch: Partial<typeof organizations.$inferInsert> = { updatedAt: new Date() };
      if (typeof input.name === "string") {
        const name = input.name.trim();
        if (!name) throw unprocessable("Organization name cannot be empty");
        patch.name = name;
      }
      if (input.parentId !== undefined) {
        patch.parentId = input.parentId ?? null;
      }
      const updated = await db
        .update(organizations)
        .set(patch)
        .where(and(eq(organizations.companyId, companyId), eq(organizations.id, orgId)))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!updated) throw notFound("Organization not found");
      return updated;
    },

    remove: async (companyId: string, orgId: string) => {
      await db.delete(organizationMembers).where(
        and(eq(organizationMembers.companyId, companyId), eq(organizationMembers.organizationId, orgId)),
      );
      const deleted = await db
        .delete(organizations)
        .where(and(eq(organizations.companyId, companyId), eq(organizations.id, orgId)))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!deleted) throw notFound("Organization not found");
      return;
    },

    listMembers: async (companyId: string, orgId: string) => {
      const org = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(eq(organizations.companyId, companyId), eq(organizations.id, orgId)))
        .then((rows) => rows[0] ?? null);
      if (!org) throw notFound("Organization not found");
      const rows = await db
        .select({
          agentId: organizationMembers.agentId,
          isManager: organizationMembers.isManager,
        })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.companyId, companyId), eq(organizationMembers.organizationId, orgId)));
      return rows;
    },

    addMember: async (
      companyId: string,
      orgId: string,
      input: { agentId: string; isManager?: boolean },
    ) => {
      const isManager = Boolean(input.isManager);
      const agentId = input.agentId;
      const existingAgent = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)))
        .then((rows) => rows[0] ?? null);
      if (!existingAgent) throw notFound("Agent not found");

      const existingOrg = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(eq(organizations.companyId, companyId), eq(organizations.id, orgId)))
        .then((rows) => rows[0] ?? null);
      if (!existingOrg) throw notFound("Organization not found");

      // simple upsert-ish behavior: remove prior membership in this org then insert
      await db.delete(organizationMembers).where(
        and(
          eq(organizationMembers.companyId, companyId),
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.agentId, agentId),
        ),
      );
      await db.insert(organizationMembers).values({
        companyId,
        organizationId: orgId,
        agentId,
        isManager,
      });
      return;
    },

    removeMember: async (companyId: string, orgId: string, agentId: string) => {
      await db.delete(organizationMembers).where(
        and(
          eq(organizationMembers.companyId, companyId),
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.agentId, agentId),
        ),
      );
      return;
    },

    setManager: async (companyId: string, orgId: string, agentId: string, isManager: boolean) => {
      const updated = await db
        .update(organizationMembers)
        .set({ isManager: Boolean(isManager), updatedAt: new Date() })
        .where(and(
          eq(organizationMembers.companyId, companyId),
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.agentId, agentId),
        ))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!updated) throw notFound("Organization member not found");
      return;
    },

    membershipByAgentIds: async (companyId: string, agentIds: string[]) => {
      if (agentIds.length === 0) return [];
      return db
        .select({
          agentId: organizationMembers.agentId,
          organizationId: organizationMembers.organizationId,
          organizationName: organizations.name,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(and(
          eq(organizationMembers.companyId, companyId),
          inArray(organizationMembers.agentId, agentIds),
        ));
    },
  };
}

