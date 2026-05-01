import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

/** Company-secret UUID placeholders (host `secrets.resolve` only accepts this shape). */
const REF_GH = "11111111-1111-4111-8111-111111111111";
const REF_GL = "22222222-2222-4222-8222-222222222222";
const REF_GL_WEBHOOK = "33333333-3333-4333-8333-333333333333";

describe("plugin-git-provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("onValidateConfig", () => {
    it("warns (but does not error) when no tokens are configured", async () => {
      const result = await plugin.definition.onValidateConfig!({});
      expect(result.ok).toBe(true);
      expect(result.warnings?.length).toBeGreaterThan(0);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("token")]),
      );
    });

    it("accepts config with only githubTokenRef", async () => {
      const result = await plugin.definition.onValidateConfig!({
        githubTokenRef: REF_GH,
      });
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/gitlabWebhookSecretRef/i)]),
      );
    });

    it("accepts config with only gitlabTokenRef", async () => {
      const result = await plugin.definition.onValidateConfig!({
        gitlabTokenRef: REF_GL,
      });
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/gitlabWebhookSecretRef/i)]),
      );
    });

    it("has no gitlabWebhookSecretRef warning when webhook ref is set", async () => {
      const result = await plugin.definition.onValidateConfig!({
        gitlabTokenRef: REF_GL,
        gitlabWebhookSecretRef: REF_GL_WEBHOOK,
      });
      expect(result.ok).toBe(true);
      expect(result.warnings?.some((w) => /gitlabWebhookSecretRef is empty/i.test(w)) ?? false).toBe(false);
    });

    it("errors when gitlabWebhookSecretRef is a raw token, not a secret UUID", async () => {
      const result = await plugin.definition.onValidateConfig!({
        gitlabTokenRef: REF_GL,
        gitlabWebhookSecretRef: "fj:!VIP#dfhd8i0nf",
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/gitlabWebhookSecretRef.*UUID/i)]),
      );
    });

    it("errors when defaultGithubApiBaseUrl is not a string", async () => {
      const result = await plugin.definition.onValidateConfig!({
        githubTokenRef: REF_GH,
        defaultGithubApiBaseUrl: 42,
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("defaultGithubApiBaseUrl")]),
      );
    });
  });

  describe("tools", () => {
    let harness: ReturnType<typeof createTestHarness>;

    beforeAll(async () => {
      harness = createTestHarness({ manifest, config: {} });
      await plugin.definition.setup(harness.ctx);
    });

    describe("github.create_pull_request", () => {
      it("returns error when githubTokenRef is not configured", async () => {
        harness.setConfig({});
        const result = await harness.executeTool("github.create_pull_request", {
          owner: "org",
          repo: "repo",
          title: "My PR",
          head: "feature",
          base: "main",
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("githubTokenRef");
      });

      it("returns error when required fields are missing", async () => {
        harness.setConfig({ githubTokenRef: REF_GH });
        const result = await harness.executeTool("github.create_pull_request", {
          owner: "org",
          // repo, title, head, base all missing
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("Missing required fields");
      });
    });

    describe("gitlab.create_merge_request", () => {
      it("returns error when gitlabTokenRef is not configured", async () => {
        harness.setConfig({});
        const result = await harness.executeTool("gitlab.create_merge_request", {
          projectId: "123",
          title: "My MR",
          sourceBranch: "feature",
          targetBranch: "main",
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("gitlabTokenRef");
      });

      it("returns error when required fields are missing", async () => {
        harness.setConfig({ gitlabTokenRef: REF_GL });
        const result = await harness.executeTool("gitlab.create_merge_request", {
          projectId: "123",
          // title, sourceBranch, targetBranch missing
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("Missing required fields");
      });

      it("prepends Draft: to title when draft=true", async () => {
        // This verifies the draft-title logic without making real HTTP calls.
        // We expect a network-failure error (not a validation error) since the
        // token resolves and all required fields are present, but the resolved
        // token will not authenticate against the real GitLab API.
        harness.setConfig({ gitlabTokenRef: REF_GL });
        const result = await harness.executeTool("gitlab.create_merge_request", {
          projectId: "group%2Frepo",
          title: "my branch",
          sourceBranch: "feature/x",
          targetBranch: "main",
          draft: true,
        });
        // Should NOT return a "Missing required fields" validation error
        expect(result.error).not.toContain("Missing required fields");
      });

      it("stores an approval link when Paperclip approval metadata is provided", async () => {
        harness.setConfig({
          gitlabTokenRef: REF_GL,
          defaultGitlabApiBaseUrl: "https://gitlab.example/api/v4",
        });
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response(
            JSON.stringify({
              web_url: "https://gitlab.example/acme/pipeline/-/merge_requests/7",
              iid: 7,
              id: 1007,
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
        );

        const result = await harness.executeTool("gitlab.create_merge_request", {
          projectId: "acme%2Fpipeline",
          title: "Sync approval",
          sourceBranch: "feature/approval-sync",
          targetBranch: "main",
          paperclipIssueId: "issue-1",
          paperclipApprovalId: "approval-1",
        });

        expect(result.error).toBeUndefined();
        const entities = await harness.ctx.entities.list({
          entityType: "gitlab-approval-link",
          externalId: "acme%2Fpipeline:7",
        });
        expect(entities).toHaveLength(1);
        expect(entities[0]?.data).toMatchObject({
          issueId: "issue-1",
          approvalId: "approval-1",
        });
      });
    });

    describe("gitlab.create_issue", () => {
      it("returns error when gitlabTokenRef is not configured", async () => {
        harness.setConfig({});
        const result = await harness.executeTool("gitlab.create_issue", {
          projectId: "123",
          title: "New issue",
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("gitlabTokenRef");
      });

      it("returns error when required fields are missing", async () => {
        harness.setConfig({ gitlabTokenRef: REF_GL });
        const result = await harness.executeTool("gitlab.create_issue", {
          projectId: "123",
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("Missing required fields");
      });

      it("stores gitlab-issue-link and comments Paperclip issue when paperclipIssueId is set", async () => {
        const issueId = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
        const now = new Date();
        harness.seed({
          issues: [
            {
              id: issueId,
              companyId: "company-test",
              projectId: "project-test",
              projectWorkspaceId: null,
              goalId: null,
              parentId: null,
              title: "PC task",
              description: null,
              status: "in_progress",
              priority: "medium",
              assigneeAgentId: null,
              assigneeUserId: null,
              checkoutRunId: null,
              executionRunId: null,
              executionAgentNameKey: null,
              executionLockedAt: null,
              createdByAgentId: null,
              createdByUserId: null,
              issueNumber: 81,
              identifier: "PIP-81",
              requestDepth: 0,
              billingCode: null,
              assigneeAdapterOverrides: null,
              executionWorkspaceId: null,
              executionWorkspacePreference: null,
              executionWorkspaceSettings: null,
              startedAt: null,
              completedAt: null,
              cancelledAt: null,
              hiddenAt: null,
              createdAt: now,
              updatedAt: now,
            },
          ],
        });
        harness.setConfig({
          gitlabTokenRef: REF_GL,
          defaultGitlabApiBaseUrl: "https://gitlab.example/api/v4",
        });
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response(
            JSON.stringify({
              web_url: "https://gitlab.example/acme/pipeline/-/issues/3",
              iid: 3,
              id: 9001,
            }),
            { status: 201 },
          ),
        );
        const result = await harness.executeTool("gitlab.create_issue", {
          projectId: "acme%2Fpipeline",
          title: "GL from agent",
          description: "Body",
          paperclipIssueId: issueId,
        });
        expect(result.error).toBeUndefined();
        const entities = await harness.ctx.entities.list({
          entityType: "gitlab-issue-link",
          externalId: "acme%2Fpipeline:3",
        });
        expect(entities).toHaveLength(1);
        expect(entities[0]?.data).toMatchObject({
          paperclipIssueId: issueId,
          issueIid: 3,
          projectId: "acme%2Fpipeline",
        });
        const comments = await harness.ctx.issues.listComments(issueId, "company-test");
        expect(comments.some((c) => c.body.includes("GitLab issue registered"))).toBe(true);
        expect(comments.some((c) => c.body.includes("https://gitlab.example/acme/pipeline/-/issues/3"))).toBe(
          true,
        );
      });
    });

    describe("gitlab.create_branch", () => {
      it("returns error when gitlabTokenRef is not configured", async () => {
        harness.setConfig({});
        const result = await harness.executeTool("gitlab.create_branch", {
          projectId: "123",
          branch: "feature/x",
          ref: "main",
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("gitlabTokenRef");
      });

      it("returns error when required fields are missing", async () => {
        harness.setConfig({ gitlabTokenRef: REF_GL });
        const result = await harness.executeTool("gitlab.create_branch", {
          projectId: "123",
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("Missing required fields");
      });
    });

    describe("gitlab.create_commit", () => {
      it("returns error when gitlabTokenRef is not configured", async () => {
        harness.setConfig({});
        const result = await harness.executeTool("gitlab.create_commit", {
          projectId: "123",
          branch: "main",
          commitMessage: "msg",
          actions: [{ action: "create", file_path: "a.txt", content: "x" }],
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("gitlabTokenRef");
      });

      it("returns error when actions is empty", async () => {
        harness.setConfig({ gitlabTokenRef: REF_GL });
        const result = await harness.executeTool("gitlab.create_commit", {
          projectId: "123",
          branch: "main",
          commitMessage: "msg",
          actions: [],
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("non-empty");
      });

      it("returns error when create action omits content", async () => {
        harness.setConfig({ gitlabTokenRef: REF_GL });
        const result = await harness.executeTool("gitlab.create_commit", {
          projectId: "123",
          branch: "main",
          commitMessage: "msg",
          actions: [{ action: "create", file_path: "a.txt" }],
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("content");
      });

      it("creates a commit via Repository Commits API when HTTP succeeds", async () => {
        harness.setConfig({
          gitlabTokenRef: REF_GL,
          defaultGitlabApiBaseUrl: "https://gitlab.example/api/v4",
        });
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response(
            JSON.stringify({
              id: "abc123def",
              short_id: "abc123d",
              web_url: "https://gitlab.example/acme/pipeline/-/commit/abc123def",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
        );

        const result = await harness.executeTool("gitlab.create_commit", {
          projectId: "acme/pipeline",
          branch: "paperclip/automation",
          commitMessage: "Apply patch",
          actions: [
            { action: "update", file_path: "README.md", content: "# ok\n" },
            { action: "create", file_path: "notes/new.md", content: "hi" },
          ],
        });

        expect(result.error).toBeUndefined();
        expect(result.content).toContain("GitLab commit created");
        expect(globalThis.fetch).toHaveBeenCalled();
        const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call[0]).toContain("/projects/acme%2Fpipeline/repository/commits");
        const init = call[1] as RequestInit;
        expect(init.method).toBe("POST");
        const parsed = JSON.parse(String(init.body));
        expect(parsed.branch).toBe("paperclip/automation");
        expect(parsed.commit_message).toBe("Apply patch");
        expect(parsed.actions).toHaveLength(2);
      });
    });

    describe("gitlab.get_issue", () => {
      it("returns error when gitlabTokenRef is not configured", async () => {
        harness.setConfig({});
        const result = await harness.executeTool("gitlab.get_issue", {
          projectId: "123",
          issueIid: 1,
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("gitlabTokenRef");
      });

      it("returns error when required fields are missing", async () => {
        harness.setConfig({ gitlabTokenRef: REF_GL });
        const result = await harness.executeTool("gitlab.get_issue", {
          // projectId and issueIid both missing
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("Missing required fields");
      });
    });

    describe("gitlab.create_issue_note", () => {
      it("returns error when gitlabTokenRef is not configured", async () => {
        harness.setConfig({});
        const result = await harness.executeTool("gitlab.create_issue_note", {
          projectId: "123",
          issueIid: 1,
          body: "A note",
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("gitlabTokenRef");
      });
    });

    describe("gitlab.update_issue", () => {
      it("returns error when no update fields are provided", async () => {
        harness.setConfig({ gitlabTokenRef: REF_GL });
        const result = await harness.executeTool("gitlab.update_issue", {
          projectId: "123",
          issueIid: 1,
          // no stateEvent / labels / addLabels / removeLabels
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("No update fields");
      });

      it("returns error when gitlabTokenRef is not configured", async () => {
        harness.setConfig({});
        const result = await harness.executeTool("gitlab.update_issue", {
          projectId: "123",
          issueIid: 1,
          stateEvent: "close",
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("gitlabTokenRef");
      });
    });

    describe("gitlab.get_pipeline_status", () => {
      it("returns error when gitlabTokenRef is not configured", async () => {
        harness.setConfig({});
        const result = await harness.executeTool("gitlab.get_pipeline_status", {
          projectId: "123",
          pipelineId: 42,
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("gitlabTokenRef");
      });

      it("returns error when required fields are missing", async () => {
        harness.setConfig({ gitlabTokenRef: REF_GL });
        const result = await harness.executeTool("gitlab.get_pipeline_status", {
          // projectId and pipelineId both missing
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("Missing required fields");
      });
    });

    describe("gitlab.list_project_pipelines", () => {
      it("returns error when gitlabTokenRef is not configured", async () => {
        harness.setConfig({});
        const result = await harness.executeTool("gitlab.list_project_pipelines", {
          projectId: "123",
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("gitlabTokenRef");
      });

      it("returns error when projectId is missing", async () => {
        harness.setConfig({ gitlabTokenRef: REF_GL });
        const result = await harness.executeTool("gitlab.list_project_pipelines", {});
        expect(result.error).toBeDefined();
        expect(result.error).toContain("projectId");
      });
    });

    describe("gitlab.list_mr_discussions", () => {
      it("returns error when gitlabTokenRef is not configured", async () => {
        harness.setConfig({});
        const result = await harness.executeTool("gitlab.list_mr_discussions", {
          projectId: "123",
          mrIid: 1,
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("gitlabTokenRef");
      });

      it("returns error when required fields are missing", async () => {
        harness.setConfig({ gitlabTokenRef: REF_GL });
        const result = await harness.executeTool("gitlab.list_mr_discussions", {
          // projectId and mrIid missing
        });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("Missing required fields");
      });
    });

    describe("gitlab webhook approval sync", () => {
      it("approves a linked Paperclip approval on GitLab approved webhook", async () => {
        harness.setConfig({ gitlabWebhookSecretRef: REF_GL_WEBHOOK });
        harness.seed({
          issues: [
            {
              id: "issue-1",
              companyId: "company-test",
              projectId: "project-test",
              goalId: null,
              parentId: null,
              title: "Issue",
              description: null,
              status: "todo",
              priority: "high",
              assigneeAgentId: null,
              assigneeUserId: null,
              checkoutRunId: null,
              executionRunId: null,
              executionAgentNameKey: null,
              executionLockedAt: null,
              createdByAgentId: null,
              createdByUserId: null,
              issueNumber: 1,
              identifier: "PIP-1",
              requestDepth: 0,
              billingCode: null,
              assigneeAdapterOverrides: null,
              executionWorkspaceId: null,
              executionWorkspacePreference: null,
              executionWorkspaceSettings: null,
              startedAt: null,
              completedAt: null,
              cancelledAt: null,
              hiddenAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as any,
          ],
          approvals: [
            {
              id: "approval-1",
              companyId: "company-test",
              type: "approve_ceo_strategy",
              requestedByAgentId: null,
              requestedByUserId: null,
              status: "pending",
              payload: {},
              decisionNote: null,
              decidedByUserId: null,
              decidedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as any,
          ],
          issueApprovalLinks: [{ issueId: "issue-1", approvalId: "approval-1" }],
        });
        await harness.ctx.entities.upsert({
          entityType: "gitlab-approval-link",
          scopeKind: "company",
          scopeId: "company-test",
          externalId: "acme%2Fpipeline:42",
          data: {
            companyId: "company-test",
            projectId: "acme%2Fpipeline",
            mrIid: 42,
            issueId: "issue-1",
            approvalId: "approval-1",
          },
        });

        await plugin.definition.onWebhook?.({
          endpointKey: "gitlab",
          requestId: "req-1",
          headers: { "X-Gitlab-Token": `resolved:${REF_GL_WEBHOOK}` },
          rawBody: JSON.stringify({
            object_kind: "merge_request",
            project: { id: "acme%2Fpipeline" },
            object_attributes: { iid: 42, action: "approved", url: "https://gitlab.example/mr/42" },
          }),
        });

        const approvals = await harness.ctx.approvals.listForIssue("issue-1", "company-test");
        expect(approvals[0]?.status).toBe("approved");
        expect(approvals[0]?.decisionNote).toContain("GitLab MR 42 approved");
      });

      it("does not call secrets.resolve when gitlabWebhookSecretRef is a raw token", async () => {
        harness.setConfig({ gitlabWebhookSecretRef: "fj:!VIP#dfhd8i0nf" });
        const resolveSpy = vi.spyOn(harness.ctx.secrets, "resolve");
        await expect(
          plugin.definition.onWebhook?.({
            endpointKey: "gitlab",
            requestId: "req-raw",
            headers: { "X-Gitlab-Token": "any" },
            rawBody: "{}",
          }),
        ).rejects.toThrow(/company secret UUID/i);
        expect(resolveSpy).not.toHaveBeenCalled();
      });
    });

    it("logs setup info on startup", async () => {
      expect(
        harness.logs.some((l) => l.level === "info" && l.message.includes("registered")),
      ).toBe(true);
    });
  });
});
