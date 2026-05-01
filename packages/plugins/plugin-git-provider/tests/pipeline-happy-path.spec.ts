import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import gitManifest from "../src/manifest.js";
import gitPlugin from "../src/worker.js";
import obsManifest from "../../plugin-obsidian-brain/src/manifest.js";
import obsPlugin from "../../plugin-obsidian-brain/src/worker.js";

describe("pipeline happy path integration", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-pipeline-happy-path-"));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes to Obsidian and creates a GitLab MR with readable activity logs", async () => {
    const obsidian = createTestHarness({
      manifest: obsManifest,
      config: {
        vaultRoot: tmpDir,
        brainSubdir: "Brain",
        enforceMdExtension: true,
      },
    });
    await obsPlugin.definition.setup(obsidian.ctx);

    const git = createTestHarness({
      manifest: gitManifest,
      config: {
        gitlabTokenRef: "secret/gl-pat",
        defaultGitlabApiBaseUrl: "https://gitlab.example/api/v4",
      },
    });
    await gitPlugin.definition.setup(git.ctx);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          web_url: "https://gitlab.example/acme/pipeline/-/merge_requests/42",
          iid: 42,
          id: 1042,
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const runCtx = {
      companyId: "co-pipeline",
      projectId: "project-pipeline",
      agentId: "agent-pipeline",
      runId: "run-pipeline",
    };

    const noteWrite = await obsidian.executeTool(
      "obsidian_brain.write",
      {
        relativePath: "runs/happy-path.md",
        content: "# Happy Path\n\nInput received and processed.",
      },
      runCtx,
    );
    expect(noteWrite.error).toBeUndefined();

    const noteRead = await obsidian.executeTool(
      "obsidian_brain.read",
      { relativePath: "runs/happy-path.md" },
      runCtx,
    );
    expect(noteRead.error).toBeUndefined();
    expect((noteRead.data as { content: string }).content).toContain("Input received");

    const mrResult = await git.executeTool(
      "gitlab.create_merge_request",
      {
        projectId: "acme%2Fpipeline",
        title: "Pipeline smoke artifact",
        description: "Created from integration test.",
        sourceBranch: "paperclip/pipeline-smoke",
        targetBranch: "master",
      },
      runCtx,
    );

    expect(mrResult.error).toBeUndefined();
    expect((mrResult.data as { url: string }).url).toContain("/merge_requests/42");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      obsidian.activity.some(
        (entry) =>
          entry.message.startsWith("Obsidian brain write: runs/happy-path.md") && entry.message.includes("→"),
      ),
    ).toBe(true);
    expect(git.activity.some((entry) => entry.message.includes("Created GitLab MR"))).toBe(true);
  });
});
