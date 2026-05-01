import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { organizationsService } from "../services/organizations.js";
import { assertCompanyAccess } from "./authz.js";

const createOrgSchema = z.object({
  name: z.string().min(1),
  level: z.enum(["department", "team"]),
  parentId: z.string().uuid().nullable().optional(),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const addMemberSchema = z.object({
  agentId: z.string().uuid(),
  isManager: z.boolean().optional(),
});

const setManagerSchema = z.object({
  isManager: z.boolean(),
});

export function organizationRoutes(db: Db) {
  const router = Router();
  const svc = organizationsService(db);

  router.get("/companies/:companyId/organizations", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.list(companyId));
  });

  router.post("/companies/:companyId/organizations", validate(createOrgSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const org = await svc.create(companyId, req.body);
    res.status(201).json(org);
  });

  router.patch("/companies/:companyId/organizations/:orgId", validate(updateOrgSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const orgId = req.params.orgId as string;
    res.json(await svc.update(companyId, orgId, req.body));
  });

  router.delete("/companies/:companyId/organizations/:orgId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const orgId = req.params.orgId as string;
    await svc.remove(companyId, orgId);
    res.status(204).send();
  });

  router.get("/companies/:companyId/organizations/:orgId/members", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const orgId = req.params.orgId as string;
    res.json(await svc.listMembers(companyId, orgId));
  });

  router.post("/companies/:companyId/organizations/:orgId/members", validate(addMemberSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const orgId = req.params.orgId as string;
    await svc.addMember(companyId, orgId, req.body);
    res.status(204).send();
  });

  router.delete("/companies/:companyId/organizations/:orgId/members/:agentId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const orgId = req.params.orgId as string;
    const agentId = req.params.agentId as string;
    await svc.removeMember(companyId, orgId, agentId);
    res.status(204).send();
  });

  router.patch(
    "/companies/:companyId/organizations/:orgId/members/:agentId",
    validate(setManagerSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const orgId = req.params.orgId as string;
      const agentId = req.params.agentId as string;
      await svc.setManager(companyId, orgId, agentId, req.body.isManager);
      res.status(204).send();
    },
  );

  return router;
}

