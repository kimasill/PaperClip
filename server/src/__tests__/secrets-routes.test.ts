import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { secretRoutes } from "../routes/secrets.js";

const mockSecretService = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  listProviders: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  secretService: () => mockSecretService,
  logActivity: mockLogActivity,
}));

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor: typeof actor }).actor = actor as any;
    next();
  });
  app.use("/api", secretRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("secret routes — company create/list", () => {
  const companyId = "573df7f3-88cf-4b4e-964a-eef78577a2f2";
  const agentId = "eb928fcd-be40-40ff-a6e5-d259203c8b37";

  beforeEach(() => {
    vi.clearAllMocks();
    mockSecretService.listProviders.mockReturnValue([]);
  });

  it("returns 201 and secret id (uuid) for board create", async () => {
    const created = {
      id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      companyId,
      name: "gitlab-webhook-token",
      provider: "local_encrypted",
      externalRef: null,
      latestVersion: 1,
      description: "GitLab MR webhook",
      createdByAgentId: null,
      createdByUserId: "local-board",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockSecretService.create.mockResolvedValue(created);

    const app = createApp({
      type: "board",
      userId: "local-board",
      source: "local_implicit",
      companyIds: [companyId],
    });

    const res = await request(app)
      .post(`/api/companies/${companyId}/secrets`)
      .send({
        name: "gitlab-webhook-token",
        value: "fj-!VIP#dfhd8i0nf",
        description: "GitLab MR webhook",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(res.body.id).toBe(created.id);
    expect(mockSecretService.create).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({
        name: "gitlab-webhook-token",
        value: "fj-!VIP#dfhd8i0nf",
        description: "GitLab MR webhook",
      }),
      { userId: "local-board", agentId: null },
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId,
        actorType: "user",
        action: "secret.created",
        entityId: created.id,
      }),
    );
  });

  it("returns 201 when activity log fails after secret create", async () => {
    const created = {
      id: "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f",
      companyId,
      name: "pat",
      provider: "local_encrypted",
      externalRef: null,
      latestVersion: 1,
      description: null,
      createdByAgentId: null,
      createdByUserId: "local-board",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockSecretService.create.mockResolvedValue(created);
    mockLogActivity.mockRejectedValueOnce(new Error("activity insert failed"));

    const app = createApp({
      type: "board",
      userId: "local-board",
      source: "local_implicit",
      companyIds: [companyId],
    });

    const res = await request(app)
      .post(`/api/companies/${companyId}/secrets`)
      .send({ name: "pat", value: "glpat-xxx" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(created.id);
    expect(mockSecretService.create).toHaveBeenCalled();
    expect(mockLogActivity).toHaveBeenCalled();
  });

  it("allows same-company agent to create and logs agent actor", async () => {
    const created = {
      id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
      companyId,
      name: "agent-secret",
      provider: "local_encrypted",
      externalRef: null,
      latestVersion: 1,
      description: null,
      createdByAgentId: agentId,
      createdByUserId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockSecretService.create.mockResolvedValue(created);

    const app = createApp({
      type: "agent",
      agentId,
      companyId,
      runId: "14966836-18f0-4370-8086-a085e268f95f",
    });

    const res = await request(app)
      .post(`/api/companies/${companyId}/secrets`)
      .send({ name: "agent-secret", value: "raw-value" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(created.id);
    expect(mockSecretService.create).toHaveBeenCalledWith(
      companyId,
      expect.any(Object),
      { userId: null, agentId },
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "agent",
        actorId: agentId,
        agentId,
        runId: "14966836-18f0-4370-8086-a085e268f95f",
      }),
    );
  });

  it("rejects agent create for another company", async () => {
    const otherCompany = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const app = createApp({
      type: "agent",
      agentId,
      companyId,
    });

    const res = await request(app)
      .post(`/api/companies/${otherCompany}/secrets`)
      .send({ name: "x", value: "y" });

    expect(res.status).toBe(403);
    expect(mockSecretService.create).not.toHaveBeenCalled();
  });

  it("allows same-company agent to list secrets metadata", async () => {
    mockSecretService.list.mockResolvedValue([]);

    const app = createApp({
      type: "agent",
      agentId,
      companyId,
    });

    const res = await request(app).get(`/api/companies/${companyId}/secrets`);
    expect(res.status).toBe(200);
    expect(mockSecretService.list).toHaveBeenCalledWith(companyId);
  });
});
