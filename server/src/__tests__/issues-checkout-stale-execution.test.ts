import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping stale execution checkout tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issueService.checkout stale executionRunId recovery", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issues-checkout-stale-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("lets the assignee checkout when checkoutRunId is null and executionRunId is a finished run", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const oldRunId = randomUUID();
    const newRunId = randomUUID();
    const issueId = randomUUID();
    const now = new Date();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "cursor",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values([
      {
        id: oldRunId,
        companyId,
        agentId,
        invocationSource: "heartbeat_timer",
        status: "succeeded",
        startedAt: now,
        finishedAt: now,
        updatedAt: now,
      },
      {
        id: newRunId,
        companyId,
        agentId,
        invocationSource: "heartbeat_timer",
        status: "running",
        startedAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Stuck execution lock",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      checkoutRunId: null,
      executionRunId: oldRunId,
      issueNumber: 1,
      identifier: "TST-1",
    });

    const updated = await svc.checkout(issueId, agentId, ["in_progress"], newRunId);
    expect(updated.checkoutRunId).toBe(newRunId);
    expect(updated.executionRunId).toBe(newRunId);
  });

  it("lets the assignee checkout from todo when checkoutRunId is null and executionRunId is a finished run", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const oldRunId = randomUUID();
    const newRunId = randomUUID();
    const issueId = randomUUID();
    const now = new Date();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "cursor",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values([
      {
        id: oldRunId,
        companyId,
        agentId,
        invocationSource: "heartbeat_timer",
        status: "succeeded",
        startedAt: now,
        finishedAt: now,
        updatedAt: now,
      },
      {
        id: newRunId,
        companyId,
        agentId,
        invocationSource: "heartbeat_timer",
        status: "running",
        startedAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Todo stale execution lock",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
      checkoutRunId: null,
      executionRunId: oldRunId,
      issueNumber: 2,
      identifier: "TST-1B",
    });

    const updated = await svc.checkout(issueId, agentId, ["todo", "backlog", "blocked"], newRunId);
    expect(updated.status).toBe("in_progress");
    expect(updated.checkoutRunId).toBe(newRunId);
    expect(updated.executionRunId).toBe(newRunId);
    expect(updated.startedAt).toBeTruthy();
  });

  it("reclaims checkout when executionRunId references a running run but checkoutRunId is null", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const oldRunId = randomUUID();
    const newRunId = randomUUID();
    const issueId = randomUUID();
    const now = new Date();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "cursor",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values([
      {
        id: oldRunId,
        companyId,
        agentId,
        invocationSource: "on_demand",
        status: "running",
        startedAt: now,
        updatedAt: now,
      },
      {
        id: newRunId,
        companyId,
        agentId,
        invocationSource: "heartbeat_timer",
        status: "running",
        startedAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Active execution lock",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      checkoutRunId: null,
      executionRunId: oldRunId,
      issueNumber: 1,
      identifier: "TST-2",
    });

    const updated = await svc.checkout(issueId, agentId, ["in_progress"], newRunId);
    expect(updated.checkoutRunId).toBe(newRunId);
    expect(updated.executionRunId).toBe(newRunId);
  });

  it("lets the assignee checkout when the stale execution run is queued (not actively running)", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const oldRunId = randomUUID();
    const newRunId = randomUUID();
    const issueId = randomUUID();
    const now = new Date();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "cursor",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values([
      {
        id: oldRunId,
        companyId,
        agentId,
        invocationSource: "heartbeat_timer",
        status: "queued",
        updatedAt: now,
      },
      {
        id: newRunId,
        companyId,
        agentId,
        invocationSource: "heartbeat_timer",
        status: "running",
        startedAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Queued stale execution lock",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      checkoutRunId: null,
      executionRunId: oldRunId,
      issueNumber: 3,
      identifier: "TST-3",
    });

    const updated = await svc.checkout(issueId, agentId, ["in_progress"], newRunId);
    expect(updated.checkoutRunId).toBe(newRunId);
    expect(updated.executionRunId).toBe(newRunId);
  });
});
