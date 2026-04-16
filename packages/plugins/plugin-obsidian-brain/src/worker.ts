import fs from "node:fs/promises";
import path from "node:path";
import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type ToolResult,
  type ToolRunContext,
} from "@paperclipai/plugin-sdk";
import { agentBrainDir, normalizeVaultRootInput, resolveBrainRoots, type BrainRoots } from "./brain-paths.js";
import type { ObsidianBrainConfig } from "./config.js";
import { PLUGIN_ID } from "./manifest.js";
import {
  reindexSemanticScope,
  reindexSingleAgentFile,
  reindexSingleCommonFile,
  runSemanticSearch,
} from "./semantic-search.js";

let currentContext: PluginContext | null = null;

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function vaultRootLooksLikeManagedPaperclipProject(absResolved: string): boolean {
  const norm = absResolved.replace(/\\/g, "/").toLowerCase();
  return norm.includes("/.paperclip/") && norm.includes("/projects/");
}

async function getConfig(ctx: PluginContext): Promise<ObsidianBrainConfig> {
  return (await ctx.config.get()) as ObsidianBrainConfig;
}

function parseOrchestratorIds(raw: string | undefined): Set<string> {
  if (!raw || typeof raw !== "string") return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function isAllowedCommonWrite(cfg: ObsidianBrainConfig, agentId: string): boolean {
  if (cfg.allowAllAgentsCommonWrite === true) {
    return true;
  }
  return parseOrchestratorIds(cfg.orchestratorAgentIds).has(agentId);
}

function ensureInsideRoot(rootDir: string, relativePath: string): string {
  const root = path.resolve(rootDir);
  let normalized = relativePath.replace(/\\/g, "/").trim();
  normalized = normalized.replace(/^\/+/, "");
  if (!normalized) {
    return root;
  }
  if (normalized.includes("..")) {
    throw new Error("Path must not contain '..'");
  }
  const resolved = path.resolve(root, normalized);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes allowed directory");
  }
  return resolved;
}

function assertMdPath(filePath: string, enforce: boolean): void {
  if (!enforce) return;
  if (!filePath.toLowerCase().endsWith(".md")) {
    throw new Error("Paths must use the .md extension when enforceMdExtension is enabled");
  }
}

function normalizeInputRelative(raw: string): string {
  return raw.replace(/\\/g, "/").trim().replace(/^\/+/, "");
}

function scheduleSemanticReindexAgentFile(cfg: ObsidianBrainConfig, roots: BrainRoots, agentId: string, relativePath: string) {
  if (cfg.semanticSearchEnabled === false) return;
  setImmediate(() => {
    void reindexSingleAgentFile(cfg, roots, agentId, relativePath).catch(() => {
      /* best-effort */
    });
  });
}

function scheduleSemanticReindexCommonFile(cfg: ObsidianBrainConfig, roots: BrainRoots, relativePath: string) {
  if (cfg.semanticSearchEnabled === false) return;
  setImmediate(() => {
    void reindexSingleCommonFile(cfg, roots, relativePath).catch(() => {
      /* best-effort */
    });
  });
}

function resolveReadTarget(
  roots: BrainRoots,
  agentId: string,
  relativePath: string,
): { fullPath: string; label: string } {
  const norm = normalizeInputRelative(relativePath);
  if (!norm) {
    throw new Error("relativePath is required");
  }
  const commonPrefix = /^common\//i;
  if (commonPrefix.test(norm)) {
    const rest = norm.replace(commonPrefix, "");
    const full = ensureInsideRoot(roots.commonRoot, rest);
    return { fullPath: full, label: `common/${rest}` };
  }
  const agentBase = agentBrainDir(roots, agentId);
  const full = ensureInsideRoot(agentBase, norm);
  return { fullPath: full, label: norm };
}

function resolveAgentWritePath(roots: BrainRoots, agentId: string, relativePath: string): string {
  const norm = normalizeInputRelative(relativePath);
  if (!norm) {
    throw new Error("relativePath is required");
  }
  if (/^common\//i.test(norm)) {
    throw new Error("Use obsidian_brain.write_common to write under common/");
  }
  const agentBase = agentBrainDir(roots, agentId);
  return ensureInsideRoot(agentBase, norm);
}

function resolveCommonWritePath(roots: BrainRoots, relativePath: string): string {
  const norm = normalizeInputRelative(relativePath);
  if (!norm) {
    throw new Error("relativePath is required");
  }
  const stripped = norm.replace(/^common\//i, "");
  return ensureInsideRoot(roots.commonRoot, stripped);
}

function resolveListDir(roots: BrainRoots, agentId: string, scope: string, subPath: string): string {
  const norm = normalizeInputRelative(subPath);
  if (scope === "common") {
    return norm ? ensureInsideRoot(roots.commonRoot, norm) : roots.commonRoot;
  }
  const agentBase = agentBrainDir(roots, agentId);
  return norm ? ensureInsideRoot(agentBase, norm) : agentBase;
}

async function ensureListScopeRoot(roots: BrainRoots, agentId: string, scope: "agent" | "common"): Promise<void> {
  const scopeRoot = scope === "common" ? roots.commonRoot : agentBrainDir(roots, agentId);
  await fs.mkdir(scopeRoot, { recursive: true });
}

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;

    ctx.tools.register(
      "obsidian_brain.read",
      {
        displayName: "Read Obsidian brain note",
        description:
          "Read a Markdown note from your agent folder, or from common/ (prefix path with common/). Use at task start to reuse existing knowledge before rediscovering.",
        parametersSchema: {
          type: "object",
          properties: {
            relativePath: { type: "string" },
          },
          required: ["relativePath"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const pctx = currentContext;
        if (!pctx) return { error: "Plugin context not initialized" };
        const cfg = await getConfig(pctx);
        const enforceMd = Boolean(cfg.enforceMdExtension ?? true);
        const maxBytes = typeof cfg.maxReadBytes === "number" && cfg.maxReadBytes > 0 ? cfg.maxReadBytes : 262144;

        const p = params as Record<string, unknown>;
        const rel = asNonEmptyString(p.relativePath);
        if (!rel) return { error: "relativePath is required" };

        try {
          const { roots } = resolveBrainRoots(cfg, runCtx.companyId);
          const { fullPath, label } = resolveReadTarget(roots, runCtx.agentId, rel);
          assertMdPath(fullPath, enforceMd);
          const st = await fs.stat(fullPath);
          if (!st.isFile()) {
            return { error: `Not a file: ${label}` };
          }
          if (st.size > maxBytes) {
            return { error: `File too large (${st.size} bytes; max ${maxBytes})` };
          }
          const content = await fs.readFile(fullPath, "utf-8");
          return {
            content: `Read ${label} (${content.length} chars). Server path: ${fullPath}`,
            data: { path: label, absolutePath: fullPath, content },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      },
    );

    ctx.tools.register(
      "obsidian_brain.write",
      {
        displayName: "Write Obsidian brain note",
        description:
          "Create or overwrite a Markdown note in your agent folder. Save reusable artifacts, decisions, and important findings proactively. Use [[Note Title]] wikilinks to connect related notes.",
        parametersSchema: {
          type: "object",
          properties: {
            relativePath: { type: "string" },
            content: { type: "string" },
          },
          required: ["relativePath", "content"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const pctx = currentContext;
        if (!pctx) return { error: "Plugin context not initialized" };
        const cfg = await getConfig(pctx);
        const enforceMd = Boolean(cfg.enforceMdExtension ?? true);

        const p = params as Record<string, unknown>;
        const rel = asNonEmptyString(p.relativePath);
        const content = asString(p.content);
        if (!rel) return { error: "relativePath is required" };

        try {
          const { roots } = resolveBrainRoots(cfg, runCtx.companyId);
          const fullPath = resolveAgentWritePath(roots, runCtx.agentId, rel);
          assertMdPath(fullPath, enforceMd);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, "utf-8");
          await ctx.activity.log({
            companyId: runCtx.companyId,
            message: `Obsidian brain write: ${rel} → ${fullPath}`,
            metadata: { plugin: PLUGIN_ID, op: "write", agentId: runCtx.agentId, absolutePath: fullPath },
          });
          scheduleSemanticReindexAgentFile(cfg, roots, runCtx.agentId, rel);
          return {
            content: `Wrote ${rel}. File on Paperclip server: ${fullPath}`,
            data: {
              bytes: Buffer.byteLength(content, "utf8"),
              relativePath: rel,
              absolutePath: fullPath,
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      },
    );

    ctx.tools.register(
      "obsidian_brain.append",
      {
        displayName: "Append to Obsidian brain note",
        description:
          "Append text to an existing note in your agent folder. Prefer over write when adding incremental entries to logs or running notes.",
        parametersSchema: {
          type: "object",
          properties: {
            relativePath: { type: "string" },
            content: { type: "string" },
          },
          required: ["relativePath", "content"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const pctx = currentContext;
        if (!pctx) return { error: "Plugin context not initialized" };
        const cfg = await getConfig(pctx);
        const enforceMd = Boolean(cfg.enforceMdExtension ?? true);

        const p = params as Record<string, unknown>;
        const rel = asNonEmptyString(p.relativePath);
        const append = asString(p.content);
        if (!rel) return { error: "relativePath is required" };

        try {
          const { roots } = resolveBrainRoots(cfg, runCtx.companyId);
          const fullPath = resolveAgentWritePath(roots, runCtx.agentId, rel);
          assertMdPath(fullPath, enforceMd);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          let existing = "";
          try {
            existing = await fs.readFile(fullPath, "utf-8");
          } catch {
            // new file
          }
          const next = existing.length > 0 ? `${existing.trimEnd()}\n\n${append}` : append;
          await fs.writeFile(fullPath, next, "utf-8");
          await ctx.activity.log({
            companyId: runCtx.companyId,
            message: `Obsidian brain append: ${rel} → ${fullPath}`,
            metadata: { plugin: PLUGIN_ID, op: "append", agentId: runCtx.agentId, absolutePath: fullPath },
          });
          scheduleSemanticReindexAgentFile(cfg, roots, runCtx.agentId, rel);
          return {
            content: `Appended to ${rel}. File on Paperclip server: ${fullPath}`,
            data: { relativePath: rel, absolutePath: fullPath },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      },
    );

    ctx.tools.register(
      "obsidian_brain.list",
      {
        displayName: "List Obsidian brain directory",
        description:
          "List files and subdirectories. Call at task start (scope: agent) to find notes matching the current topic, then check common/ for shared team knowledge.",
        parametersSchema: {
          type: "object",
          properties: {
            scope: { type: "string", enum: ["agent", "common"] },
            subPath: { type: "string" },
          },
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const pctx = currentContext;
        if (!pctx) return { error: "Plugin context not initialized" };
        const cfg = await getConfig(pctx);

        const p = params as Record<string, unknown>;
        const scopeRaw = asString(p.scope).toLowerCase();
        const scope = scopeRaw === "common" ? "common" : "agent";
        const subPath = asString(p.subPath);

        try {
          const { roots } = resolveBrainRoots(cfg, runCtx.companyId);
          await ensureListScopeRoot(roots, runCtx.agentId, scope);
          const dir = resolveListDir(roots, runCtx.agentId, scope, subPath);
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const max = 500;
          const slice = entries.slice(0, max);
          const lines = slice.map((e) => `${e.isDirectory() ? "dir " : "file"} ${e.name}`);
          const more = entries.length > max ? `\n... and ${entries.length - max} more (cap ${max})` : "";
          return {
            content: `Listing ${scope}/${subPath || "."} (${entries.length} entries) at ${dir}${more}`,
            data: { entries: lines, truncated: entries.length > max, resolvedDirectory: dir },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      },
    );

    ctx.tools.register(
      "obsidian_brain.write_common",
      {
        displayName: "Write shared common note",
        description:
          "Create or overwrite a note under company common/. Available to all agents when company-wide access is enabled, otherwise orchestrator agents only. Use for team digests, shared references, and cross-agent knowledge.",
        parametersSchema: {
          type: "object",
          properties: {
            relativePath: { type: "string" },
            content: { type: "string" },
          },
          required: ["relativePath", "content"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const pctx = currentContext;
        if (!pctx) return { error: "Plugin context not initialized" };
        const cfg = await getConfig(pctx);
        if (!isAllowedCommonWrite(cfg, runCtx.agentId)) {
          return {
            error:
              "This agent is not allowed to write common notes. Enable allowAllAgentsCommonWrite for company-wide access, or add its id to orchestratorAgentIds in plugin settings.",
          };
        }
        const enforceMd = Boolean(cfg.enforceMdExtension ?? true);

        const p = params as Record<string, unknown>;
        const rel = asNonEmptyString(p.relativePath);
        const content = asString(p.content);
        if (!rel) return { error: "relativePath is required" };

        try {
          const { roots } = resolveBrainRoots(cfg, runCtx.companyId);
          const fullPath = resolveCommonWritePath(roots, rel);
          assertMdPath(fullPath, enforceMd);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, "utf-8");
          await ctx.activity.log({
            companyId: runCtx.companyId,
            message: `Obsidian brain write_common: ${rel} → ${fullPath}`,
            metadata: { plugin: PLUGIN_ID, op: "write_common", agentId: runCtx.agentId, absolutePath: fullPath },
          });
          scheduleSemanticReindexCommonFile(cfg, roots, rel);
          return {
            content: `Wrote common note. File on Paperclip server: ${fullPath}`,
            data: {
              bytes: Buffer.byteLength(content, "utf8"),
              relativePath: rel.replace(/^common\//i, "") || rel,
              absolutePath: fullPath,
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      },
    );

    ctx.tools.register(
      "obsidian_brain.semantic_search",
      {
        displayName: "Semantic search (RAG) over brain notes",
        description:
          "Embed the query and rank Markdown chunks from the local index (Xenova/all-MiniLM-L6-v2 by default). Use instead of bulk-reading all notes when the vault is large. Scope: agent (this agent’s folder), common, or both.",
        parametersSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural-language query for similarity search." },
            scope: {
              type: "string",
              enum: ["agent", "common", "both"],
              description: "agent = this agent’s notes; common = shared common/; both = agent + common.",
            },
            topK: { type: "number", description: "Number of chunks to return (default 5, max 15)." },
            reindexFirst: {
              type: "boolean",
              description: "If true, rebuild the index for the selected scope before searching (slow).",
            },
          },
          required: ["query"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const pctx = currentContext;
        if (!pctx) return { error: "Plugin context not initialized" };
        const cfg = await getConfig(pctx);
        try {
          const { roots } = resolveBrainRoots(cfg, runCtx.companyId);
          return await runSemanticSearch(cfg, roots, runCtx.agentId, params as Record<string, unknown>);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      },
    );

    ctx.tools.register(
      "obsidian_brain.reindex_semantic",
      {
        displayName: "Rebuild semantic search index",
        description:
          "Re-embed and re-chunk Markdown files for semantic search. Use scope agent (this agent only), common, or full (all agents + common).",
        parametersSchema: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              enum: ["agent", "common", "full"],
              description: "agent = reindex this agent’s notes only; common = shared notes; full = entire company brain tree.",
            },
          },
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const pctx = currentContext;
        if (!pctx) return { error: "Plugin context not initialized" };
        const cfg = await getConfig(pctx);
        if (cfg.semanticSearchEnabled === false) {
          return { error: "Semantic search is disabled in plugin settings." };
        }
        const p = params as Record<string, unknown>;
        const scopeRaw = String(p.scope ?? "agent").toLowerCase();
        const scope = scopeRaw === "common" ? "common" : scopeRaw === "full" ? "full" : "agent";
        try {
          const { roots } = resolveBrainRoots(cfg, runCtx.companyId);
          const result = await reindexSemanticScope(cfg, roots, runCtx.agentId, scope);
          return {
            content: `Reindexed semantic scope=${scope}: ${result.indexedFiles} files, ${result.chunkCount} chunks. Index: ${path.join(roots.companyBrainBase, ".semantic-index", "chunks.json")}`,
            data: result,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      },
    );

    ctx.logger.info("Obsidian Brain plugin tools registered", { pluginId: PLUGIN_ID });
  },

  async onValidateConfig(config) {
    const typed = config as ObsidianBrainConfig;
    const warnings: string[] = [];
    const errors: string[] = [];
    const vaultNorm = typeof typed.vaultRoot === "string" ? normalizeVaultRootInput(typed.vaultRoot) : "";
    if (!vaultNorm) {
      errors.push("vaultRoot is required (absolute path to Obsidian Vault).");
    } else {
      if (!path.isAbsolute(vaultNorm)) {
        warnings.push(
          `vaultRoot "${vaultNorm}" is not an absolute path. It will be resolved against the Paperclip server process cwd (${process.cwd()}), not the agent workspace — files will usually not appear in your Obsidian library. Use the real vault folder as an absolute path (e.g. C:\\Users\\…\\Obsidian Vault).`,
        );
      }
      const resolvedVault = path.resolve(vaultNorm);
      if (vaultRootLooksLikeManagedPaperclipProject(resolvedVault)) {
        warnings.push(
          "vaultRoot is under Paperclip's managed project directory (.paperclip/.../projects/). That tree is for per-project git checkouts. If you want the Obsidian app to open these notes, point vaultRoot at your actual Obsidian vault instead (or keep this path only if you intentionally want a repo-local mirror).",
        );
      }
    }
    const maxB = typed.maxReadBytes;
    if (maxB !== undefined && (typeof maxB !== "number" || maxB <= 0)) {
      errors.push("maxReadBytes must be a positive number when set.");
    }
    const maxChunk = typed.maxChunkChars;
    if (maxChunk !== undefined && (typeof maxChunk !== "number" || maxChunk <= 0)) {
      errors.push("maxChunkChars must be a positive number when set.");
    }
    if (typed.allowAllAgentsCommonWrite !== true && !asNonEmptyString(typed.orchestratorAgentIds)) {
      warnings.push(
        "No orchestratorAgentIds and allowAllAgentsCommonWrite is off; write_common will reject all agents.",
      );
    }
    return { ok: errors.length === 0, warnings, errors };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
