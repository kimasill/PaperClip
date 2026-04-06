import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

describe("plugin-obsidian-brain", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "obs-brain-test-"));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("onValidateConfig", () => {
    const absVault = () => path.join(tmpDir, "validate-vault-root");

    it("rejects config with missing vaultRoot", async () => {
      const result = await plugin.definition.onValidateConfig!({});
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("vaultRoot")]),
      );
    });

    it("accepts valid config with vaultRoot", async () => {
      const result = await plugin.definition.onValidateConfig!({
        vaultRoot: absVault(),
      });
      expect(result.ok).toBe(true);
    });

    it("warns when orchestratorAgentIds is not set and company-wide common write is off", async () => {
      const result = await plugin.definition.onValidateConfig!({
        vaultRoot: absVault(),
      });
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("allowAllAgentsCommonWrite")]),
      );
    });

    it("does not warn about orchestrators when allowAllAgentsCommonWrite is true", async () => {
      const result = await plugin.definition.onValidateConfig!({
        vaultRoot: absVault(),
        allowAllAgentsCommonWrite: true,
      });
      expect(result.warnings ?? []).not.toEqual(
        expect.arrayContaining([expect.stringContaining("write_common will reject")]),
      );
    });

    it("rejects invalid maxReadBytes", async () => {
      const result = await plugin.definition.onValidateConfig!({
        vaultRoot: absVault(),
        maxReadBytes: -1,
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("maxReadBytes")]),
      );
    });

    it("warns when vaultRoot is not an absolute path", async () => {
      const result = await plugin.definition.onValidateConfig!({
        vaultRoot: "obsidian-vault",
      });
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("not an absolute path")]),
      );
    });

    it("strips surrounding quotes from vaultRoot for validation", async () => {
      const inner = path.join(tmpDir, "quoted-vault");
      const result = await plugin.definition.onValidateConfig!({
        vaultRoot: `"${inner}"`,
      });
      expect(result.ok).toBe(true);
      expect(result.warnings ?? []).not.toEqual(
        expect.arrayContaining([expect.stringContaining("not an absolute path")]),
      );
    });

    it("warns when vaultRoot is under Paperclip managed projects tree", async () => {
      const nested = path.join(
        tmpDir,
        ".paperclip",
        "instances",
        "default",
        "projects",
        "co-1",
        "pr-1",
        "_default",
        "obsidian-vault",
      );
      const result = await plugin.definition.onValidateConfig!({
        vaultRoot: nested,
      });
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("managed project")]),
      );
    });
  });

  describe("tools", () => {
    let harness: ReturnType<typeof createTestHarness>;

    const baseConfig = () => ({
      vaultRoot: tmpDir,
      brainSubdir: "Brain",
      enforceMdExtension: true,
    });

    beforeAll(async () => {
      harness = createTestHarness({ manifest, config: baseConfig() });
      await plugin.definition.setup(harness.ctx);
    });

    describe("obsidian_brain.write + obsidian_brain.read", () => {
      it("round-trips content correctly", async () => {
        harness.setConfig(baseConfig());
        const runCtx = { agentId: "agent-rw", companyId: "co-1" };

        const wr = await harness.executeTool(
          "obsidian_brain.write",
          { relativePath: "notes.md", content: "# Hello\nTest content" },
          runCtx,
        );
        expect(wr.error).toBeUndefined();

        const rd = await harness.executeTool(
          "obsidian_brain.read",
          { relativePath: "notes.md" },
          runCtx,
        );
        expect(rd.error).toBeUndefined();
        expect((rd.data as { content: string }).content).toBe("# Hello\nTest content");
      });

      it("rejects path traversal with ..", async () => {
        harness.setConfig(baseConfig());
        const result = await harness.executeTool(
          "obsidian_brain.write",
          { relativePath: "../../etc/passwd.md", content: "bad" },
          { agentId: "agent-bad", companyId: "co-1" },
        );
        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/\.\./);
      });

      it("rejects non-.md path when enforceMdExtension is true", async () => {
        harness.setConfig({ ...baseConfig(), enforceMdExtension: true });
        const result = await harness.executeTool(
          "obsidian_brain.write",
          { relativePath: "notes.txt", content: "bad" },
          { agentId: "agent-ext", companyId: "co-1" },
        );
        expect(result.error).toBeDefined();
        expect(result.error).toContain(".md");
      });

      it("returns error for non-existent file on read", async () => {
        harness.setConfig(baseConfig());
        const result = await harness.executeTool(
          "obsidian_brain.read",
          { relativePath: "does-not-exist.md" },
          { agentId: "agent-miss", companyId: "co-1" },
        );
        expect(result.error).toBeDefined();
      });

      it("returns error for empty relativePath on read", async () => {
        harness.setConfig(baseConfig());
        const result = await harness.executeTool(
          "obsidian_brain.read",
          { relativePath: "" },
          { agentId: "agent-empty", companyId: "co-1" },
        );
        expect(result.error).toBeDefined();
        expect(result.error).toContain("relativePath");
      });

      it("allows reading from common/ prefix", async () => {
        harness.setConfig({
          ...baseConfig(),
          orchestratorAgentIds: "orch-agent",
        });
        // Write a common note as orchestrator first
        await harness.executeTool(
          "obsidian_brain.write_common",
          { relativePath: "shared.md", content: "# Shared" },
          { agentId: "orch-agent", companyId: "co-1" },
        );
        // Read it back from another agent using common/ prefix
        const rd = await harness.executeTool(
          "obsidian_brain.read",
          { relativePath: "common/shared.md" },
          { agentId: "another-agent", companyId: "co-1" },
        );
        expect(rd.error).toBeUndefined();
        expect((rd.data as { content: string }).content).toBe("# Shared");
      });
    });

    describe("obsidian_brain.append", () => {
      it("creates a new file if it does not exist", async () => {
        harness.setConfig(baseConfig());
        const runCtx = { agentId: "agent-ap1", companyId: "co-1" };

        await harness.executeTool(
          "obsidian_brain.append",
          { relativePath: "append-new.md", content: "first line" },
          runCtx,
        );

        const rd = await harness.executeTool(
          "obsidian_brain.read",
          { relativePath: "append-new.md" },
          runCtx,
        );
        expect(rd.error).toBeUndefined();
        expect((rd.data as { content: string }).content).toBe("first line");
      });

      it("appends to existing file without duplicating", async () => {
        harness.setConfig(baseConfig());
        const runCtx = { agentId: "agent-ap2", companyId: "co-1" };

        await harness.executeTool(
          "obsidian_brain.write",
          { relativePath: "append-existing.md", content: "first" },
          runCtx,
        );
        await harness.executeTool(
          "obsidian_brain.append",
          { relativePath: "append-existing.md", content: "second" },
          runCtx,
        );

        const rd = await harness.executeTool(
          "obsidian_brain.read",
          { relativePath: "append-existing.md" },
          runCtx,
        );
        expect((rd.data as { content: string }).content).toContain("first");
        expect((rd.data as { content: string }).content).toContain("second");
      });
    });

    describe("obsidian_brain.list", () => {
      it("lists agent-scope files after writing", async () => {
        harness.setConfig(baseConfig());
        const runCtx = { agentId: "agent-list", companyId: "co-list" };

        await harness.executeTool(
          "obsidian_brain.write",
          { relativePath: "list-target.md", content: "x" },
          runCtx,
        );

        const result = await harness.executeTool(
          "obsidian_brain.list",
          { scope: "agent" },
          runCtx,
        );
        expect(result.error).toBeUndefined();
        const entries = (result.data as { entries: string[] }).entries;
        expect(entries.some((e: string) => e.includes("list-target.md"))).toBe(true);
      });
    });

    describe("obsidian_brain.write_common", () => {
      it("rejects unauthorized agents", async () => {
        harness.setConfig({ ...baseConfig(), orchestratorAgentIds: "orch-only" });
        const result = await harness.executeTool(
          "obsidian_brain.write_common",
          { relativePath: "digest.md", content: "shared" },
          { agentId: "not-orch", companyId: "co-1" },
        );
        expect(result.error).toBeDefined();
        expect(result.error).toContain("not allowed");
      });

      it("succeeds for a configured orchestrator agent", async () => {
        harness.setConfig({ ...baseConfig(), orchestratorAgentIds: "orch-ok" });
        const result = await harness.executeTool(
          "obsidian_brain.write_common",
          { relativePath: "digest2.md", content: "# Digest" },
          { agentId: "orch-ok", companyId: "co-1" },
        );
        expect(result.error).toBeUndefined();
        expect(harness.activity.some((a) => a.message.includes("write_common"))).toBe(true);
      });

      it("allows any agent when allowAllAgentsCommonWrite is true without orchestratorAgentIds", async () => {
        harness.setConfig({ ...baseConfig(), allowAllAgentsCommonWrite: true });
        const result = await harness.executeTool(
          "obsidian_brain.write_common",
          { relativePath: "open-digest.md", content: "# Open" },
          { agentId: "any-agent-id", companyId: "co-1" },
        );
        expect(result.error).toBeUndefined();
      });

      it("rejects path with ..", async () => {
        harness.setConfig({ ...baseConfig(), orchestratorAgentIds: "orch-traverse" });
        const result = await harness.executeTool(
          "obsidian_brain.write_common",
          { relativePath: "../../evil.md", content: "bad" },
          { agentId: "orch-traverse", companyId: "co-1" },
        );
        expect(result.error).toBeDefined();
      });
    });

    it("logs setup info on startup", async () => {
      expect(harness.logs.some((l) => l.level === "info" && l.message.includes("registered"))).toBe(true);
    });

    it("logs activity on successful write", async () => {
      harness.setConfig(baseConfig());
      const before = harness.activity.length;
      await harness.executeTool(
        "obsidian_brain.write",
        { relativePath: "log-check.md", content: "logged" },
        { agentId: "agent-log", companyId: "co-1" },
      );
      expect(harness.activity.length).toBeGreaterThan(before);
    });
  });
});
