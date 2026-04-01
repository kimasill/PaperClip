import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type ToolResult,
  type ToolRunContext,
} from "@paperclipai/plugin-sdk";
import { PLUGIN_ID } from "./manifest.js";

type GitProviderConfig = {
  githubTokenRef?: string;
  gitlabTokenRef?: string;
  defaultGithubApiBaseUrl?: string;
  defaultGitlabApiBaseUrl?: string;
};

let currentContext: PluginContext | null = null;

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function getConfig(ctx: PluginContext): Promise<GitProviderConfig> {
  return (await ctx.config.get()) as GitProviderConfig;
}

async function githubRequest<T>(
  ctx: PluginContext,
  apiBaseUrl: string,
  token: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: boolean; status: number; json?: T; text: string }> {
  const res = await ctx.http.fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
      accept: "application/vnd.github+json",
      "user-agent": "paperclip-git-provider-plugin",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: T | undefined;
  try {
    json = JSON.parse(text) as T;
  } catch {
    // ignore
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function gitlabRequest<T>(
  ctx: PluginContext,
  apiBaseUrl: string,
  token: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: boolean; status: number; json?: T; text: string }> {
  const res = await ctx.http.fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, {
    method: init.method,
    headers: {
      "private-token": token,
      "content-type": "application/json; charset=utf-8",
      accept: "application/json",
      "user-agent": "paperclip-git-provider-plugin",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: T | undefined;
  try {
    json = JSON.parse(text) as T;
  } catch {
    // ignore
  }
  return { ok: res.ok, status: res.status, json, text };
}

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;

    ctx.tools.register(
      "github.create_pull_request",
      {
        displayName: "Create GitHub Pull Request",
        description: "Create a pull request on GitHub for an existing branch.",
        parametersSchema: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            head: { type: "string" },
            base: { type: "string" },
            draft: { type: "boolean" },
          },
          required: ["owner", "repo", "title", "head", "base"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const ctx = currentContext;
        if (!ctx) return { error: "Plugin context not initialized" };

        const cfg = await getConfig(ctx);
        const tokenRef = asNonEmptyString(cfg.githubTokenRef);
        if (!tokenRef) return { error: "GitHub token is not configured (githubTokenRef)" };
        const token = await ctx.secrets.resolve(tokenRef);

        const apiBaseUrl = asNonEmptyString(cfg.defaultGithubApiBaseUrl) ?? "https://api.github.com";

        const p = params as Record<string, unknown>;
        const owner = asNonEmptyString(p.owner);
        const repo = asNonEmptyString(p.repo);
        const title = asNonEmptyString(p.title);
        const body = typeof p.body === "string" ? p.body : undefined;
        const head = asNonEmptyString(p.head);
        const base = asNonEmptyString(p.base);
        const draft = Boolean(p.draft ?? false);

        if (!owner || !repo || !title || !head || !base) {
          return { error: "Missing required fields: owner, repo, title, head, base" };
        }

        const result = await githubRequest<{ html_url?: string; number?: number; state?: string; url?: string }>(
          ctx,
          apiBaseUrl,
          token,
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
          {
            method: "POST",
            body: { title, body, head, base, draft },
          },
        );

        if (!result.ok) {
          await ctx.activity.log({
            companyId: runCtx.companyId,
            message: `GitHub PR creation failed (${result.status})`,
            metadata: { provider: "github", status: result.status, response: result.text.slice(0, 2000) },
          });
          return { error: `GitHub PR creation failed (${result.status}): ${result.text.slice(0, 500)}` };
        }

        const url = result.json?.html_url ?? result.json?.url ?? "";
        await ctx.activity.log({
          companyId: runCtx.companyId,
          message: `Created GitHub PR${url ? `: ${url}` : ""}`,
          metadata: { provider: "github", url, prNumber: result.json?.number ?? null },
        });

        return {
          content: url ? `GitHub PR created: ${url}` : "GitHub PR created.",
          data: { url, pr: result.json },
        };
      },
    );

    ctx.tools.register(
      "gitlab.create_merge_request",
      {
        displayName: "Create GitLab Merge Request",
        description: "Create a merge request on GitLab for an existing branch.",
        parametersSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            sourceBranch: { type: "string" },
            targetBranch: { type: "string" },
            removeSourceBranch: { type: "boolean" },
            draft: { type: "boolean" },
          },
          required: ["projectId", "title", "sourceBranch", "targetBranch"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const ctx = currentContext;
        if (!ctx) return { error: "Plugin context not initialized" };

        const cfg = await getConfig(ctx);
        const tokenRef = asNonEmptyString(cfg.gitlabTokenRef);
        if (!tokenRef) return { error: "GitLab token is not configured (gitlabTokenRef)" };
        const token = await ctx.secrets.resolve(tokenRef);

        const apiBaseUrl = asNonEmptyString(cfg.defaultGitlabApiBaseUrl) ?? "https://gitlab.com/api/v4";

        const p = params as Record<string, unknown>;
        const projectId = asNonEmptyString(p.projectId);
        const title = asNonEmptyString(p.title);
        const description = typeof p.description === "string" ? p.description : undefined;
        const sourceBranch = asNonEmptyString(p.sourceBranch);
        const targetBranch = asNonEmptyString(p.targetBranch);
        const removeSourceBranch = Boolean(p.removeSourceBranch ?? false);
        const draft = Boolean(p.draft ?? false);

        if (!projectId || !title || !sourceBranch || !targetBranch) {
          return { error: "Missing required fields: projectId, title, sourceBranch, targetBranch" };
        }

        const effectiveTitle = draft && !title.toLowerCase().startsWith("draft:") ? `Draft: ${title}` : title;

        const result = await gitlabRequest<{ web_url?: string; iid?: number; id?: number }>(
          ctx,
          apiBaseUrl,
          token,
          `/projects/${encodeURIComponent(projectId)}/merge_requests`,
          {
            method: "POST",
            body: {
              title: effectiveTitle,
              description,
              source_branch: sourceBranch,
              target_branch: targetBranch,
              remove_source_branch: removeSourceBranch,
            },
          },
        );

        if (!result.ok) {
          await ctx.activity.log({
            companyId: runCtx.companyId,
            message: `GitLab MR creation failed (${result.status})`,
            metadata: { provider: "gitlab", status: result.status, response: result.text.slice(0, 2000) },
          });
          return { error: `GitLab MR creation failed (${result.status}): ${result.text.slice(0, 500)}` };
        }

        const url = result.json?.web_url ?? "";
        await ctx.activity.log({
          companyId: runCtx.companyId,
          message: `Created GitLab MR${url ? `: ${url}` : ""}`,
          metadata: { provider: "gitlab", url, mrIid: result.json?.iid ?? null, mrId: result.json?.id ?? null },
        });

        return {
          content: url ? `GitLab MR created: ${url}` : "GitLab MR created.",
          data: { url, mr: result.json },
        };
      },
    );

    ctx.logger.info("Git Provider plugin tools registered", { pluginId: PLUGIN_ID });
  },

  async onValidateConfig(config) {
    const typed = config as GitProviderConfig;
    const warnings: string[] = [];
    const errors: string[] = [];
    if (!asNonEmptyString(typed.githubTokenRef) && !asNonEmptyString(typed.gitlabTokenRef)) {
      warnings.push("No provider token configured; tools will error until githubTokenRef or gitlabTokenRef is set.");
    }
    const gh = typed.defaultGithubApiBaseUrl;
    const gl = typed.defaultGitlabApiBaseUrl;
    if (gh && typeof gh !== "string") errors.push("defaultGithubApiBaseUrl must be a string");
    if (gl && typeof gl !== "string") errors.push("defaultGitlabApiBaseUrl must be a string");
    return { ok: errors.length === 0, warnings, errors };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

