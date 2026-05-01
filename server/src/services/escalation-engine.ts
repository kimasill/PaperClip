import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { issueService } from "./issues.js";

const ESCALATION_HEARTBEAT_THRESHOLD = 2;

export type EscalationHeartbeatDeps = {
  wakeup: (
    agentId: string,
    opts: {
      source?: "assignment" | "automation" | "on_demand" | "timer";
      triggerDetail?: "manual" | "ping" | "callback" | "system";
      reason?: string | null;
      payload?: Record<string, unknown> | null;
      requestedByActorType?: "user" | "agent" | "system";
      requestedByActorId?: string | null;
      contextSnapshot?: Record<string, unknown>;
    },
  ) => Promise<unknown>;
};

/**
 * Server-driven escalation for issues in `blocked` status (PROTOCOL.md rules).
 */
export function escalationEngine(db: Db) {
  const issuesSvc = issueService(db);

  async function findEscalationTargetAgentId(companyId: string, assigneeAgentId: string | null) {
    if (!assigneeAgentId) return null;
    const assignee = await db
      .select({
        id: agents.id,
        reportsTo: agents.reportsTo,
        status: agents.status,
      })
      .from(agents)
      .where(and(eq(agents.id, assigneeAgentId), eq(agents.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!assignee || assignee.status === "terminated") return null;

    if (assignee.reportsTo) {
      const mgr = await db
        .select({ id: agents.id, status: agents.status })
        .from(agents)
        .where(and(eq(agents.id, assignee.reportsTo), eq(agents.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (mgr && mgr.status !== "terminated" && mgr.status !== "pending_approval") {
        return mgr.id;
      }
    }

    const ceo = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.role, "ceo")))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return ceo?.id ?? null;
  }

  async function findCeoAgentId(companyId: string) {
    const ceo = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.role, "ceo")))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return ceo?.id ?? null;
  }

  /**
   * After an agent completes any heartbeat run, increment blocked streak for their blocked issues
   * and auto-reassign when the threshold is reached.
   */
  async function onHeartbeatRunCompleted(agentId: string): Promise<void> {
    const blockedRows = await db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        escalationLevel: issues.escalationLevel,
        blockedHeartbeatCount: issues.blockedHeartbeatCount,
      })
      .from(issues)
      .where(and(eq(issues.assigneeAgentId, agentId), eq(issues.status, "blocked")));

    for (const row of blockedRows) {
      const nextCount = (row.blockedHeartbeatCount ?? 0) + 1;
      await db
        .update(issues)
        .set({ blockedHeartbeatCount: nextCount, updatedAt: new Date() })
        .where(eq(issues.id, row.id));

      if (nextCount < ESCALATION_HEARTBEAT_THRESHOLD) continue;

      const current = await db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          assigneeAgentId: issues.assigneeAgentId,
          escalationLevel: issues.escalationLevel,
          status: issues.status,
        })
        .from(issues)
        .where(eq(issues.id, row.id))
        .then((r) => r[0] ?? null);
      if (!current || current.status !== "blocked") continue;

      const level = current.escalationLevel ?? 0;
      if (level === 0) {
        const targetId = await findEscalationTargetAgentId(current.companyId, current.assigneeAgentId);
        if (!targetId || targetId === current.assigneeAgentId) continue;
        await reassignBlockedIssueSystem(current.id, targetId, {
          nextEscalationLevel: 1,
          reason: "auto_escalation_manager",
        });
      } else if (level === 1) {
        const ceoId = await findCeoAgentId(current.companyId);
        if (!ceoId || ceoId === current.assigneeAgentId) continue;
        await reassignBlockedIssueSystem(current.id, ceoId, {
          nextEscalationLevel: 2,
          reason: "auto_escalation_ceo",
        });
      }
    }
  }

  async function reassignBlockedIssueSystem(
    issueId: string,
    newAssigneeId: string,
    opts: { nextEscalationLevel: number; reason: string },
  ) {
    const updated = await issuesSvc.update(issueId, {
      assigneeAgentId: newAssigneeId,
      assigneeUserId: null,
      blockedHeartbeatCount: 0,
      escalationLevel: opts.nextEscalationLevel,
    });
    if (!updated) return;

    const mgr = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, newAssigneeId))
      .then((rows) => rows[0] ?? null);
    const label = mgr?.name ?? "Manager";
    await issuesSvc.addComment(
      issueId,
      `[escalation:${opts.reason}] Issue reassigned to @${label} for blocked-task mediation.`,
      {},
    );
    logger.info(
      { issueId, newAssigneeId, reason: opts.reason },
      "escalation: reassigned blocked issue",
    );
  }

  /**
   * When an issue first moves to `blocked`, notify the assignee's manager (or CEO) immediately.
   */
  async function onIssueJustBlocked(deps: EscalationHeartbeatDeps, issueId: string): Promise<void> {
    const row = await db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
        identifier: issues.identifier,
        title: issues.title,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    if (!row || row.status !== "blocked" || !row.assigneeAgentId) return;

    const targetId = await findEscalationTargetAgentId(row.companyId, row.assigneeAgentId);
    if (!targetId || targetId === row.assigneeAgentId) return;

    const target = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, targetId))
      .then((rows) => rows[0] ?? null);
    if (!target) return;

    const body = `[escalation:blocked_notify] @${target.name} — issue ${row.identifier ?? row.id} is BLOCKED: ${row.title}`;
    await issuesSvc.addComment(issueId, body, {});

    await deps
      .wakeup(targetId, {
        source: "automation",
        triggerDetail: "system",
        reason: "issue_blocked_escalation",
        payload: { issueId: row.id, mutation: "blocked_escalation" },
        requestedByActorType: "system",
        requestedByActorId: null,
        contextSnapshot: {
          issueId: row.id,
          source: "escalation.blocked",
          wakeReason: "issue_blocked_escalation",
        },
      })
      .catch((err) => logger.warn({ err, issueId: row.id, targetId }, "escalation: failed to wake manager on blocked"));
  }

  return {
    onHeartbeatRunCompleted,
    onIssueJustBlocked,
  };
}
