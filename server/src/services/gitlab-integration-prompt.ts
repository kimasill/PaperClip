import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { pluginCompanySettings, plugins, pluginConfig } from "@paperclipai/db";
import {
  PAPERCLIP_GITLAB_INTEGRATION_INSTRUCTION_MARKDOWN,
  PAPERCLIP_GITLAB_AUTO_ISSUE_SYNC_INSTRUCTION_MARKDOWN,
  readGitlabDefaultProjectId,
  readPaperclipGitlabIntegrationEnabled,
  readGitlabAutoIssueSync,
} from "@paperclipai/adapter-utils";

const GIT_PROVIDER_PLUGIN_KEY = "paperclip.git-provider";

const SERVER_AUTO_SYNC_NOTICE = [
  "",
  "",
  "### Server auto-sync is ACTIVE",
  "",
  "The Git Provider plugin has **`autoSyncIssues`** enabled at the instance level.",
  "Paperclip **automatically** creates and updates GitLab issues when Paperclip issues are created or their status changes — **no agent action needed for issue lifecycle**.",
  "",
  "**Do NOT** call `gitlab.create_issue` for issues that already exist on the Paperclip board — the server handles this.",
  "You may still call `gitlab.create_issue_note` to add context, and `gitlab.create_merge_request` / `gitlab.create_commit` for code delivery.",
].join("\n");

/**
 * Markdown to append to the agent run prompt when this agent opts in and Git Provider is usable for the company.
 * Detects both agent-level auto-sync preference and plugin-level server auto-sync.
 */
export async function resolveGitlabIntegrationPromptForRun(
  db: Db,
  companyId: string,
  adapterConfig: Record<string, unknown>,
): Promise<string | null> {
  if (!readPaperclipGitlabIntegrationEnabled(adapterConfig)) return null;

  const rows = await db
    .select({ id: plugins.id, status: plugins.status })
    .from(plugins)
    .where(eq(plugins.pluginKey, GIT_PROVIDER_PLUGIN_KEY))
    .limit(1);
  const plugin = rows[0];
  if (!plugin) return null;
  if (plugin.status === "disabled" || plugin.status === "uninstalled" || plugin.status === "error") {
    return null;
  }

  const settingsRows = await db
    .select({ enabled: pluginCompanySettings.enabled })
    .from(pluginCompanySettings)
    .where(and(eq(pluginCompanySettings.companyId, companyId), eq(pluginCompanySettings.pluginId, plugin.id)))
    .limit(1);
  const companyRow = settingsRows[0];
  if (companyRow && companyRow.enabled === false) return null;

  const configRows = await db
    .select({ configJson: pluginConfig.configJson })
    .from(pluginConfig)
    .where(eq(pluginConfig.pluginId, plugin.id))
    .limit(1);
  const pluginCfg = (configRows[0]?.configJson ?? {}) as Record<string, unknown>;
  const serverAutoSync = pluginCfg.autoSyncIssues === true || pluginCfg.autoSyncIssues === "true";

  const agentAutoSync = readGitlabAutoIssueSync(adapterConfig);

  let basePrompt: string;
  if (serverAutoSync) {
    basePrompt = PAPERCLIP_GITLAB_INTEGRATION_INSTRUCTION_MARKDOWN + SERVER_AUTO_SYNC_NOTICE;
  } else if (agentAutoSync) {
    basePrompt = PAPERCLIP_GITLAB_AUTO_ISSUE_SYNC_INSTRUCTION_MARKDOWN;
  } else {
    basePrompt = PAPERCLIP_GITLAB_INTEGRATION_INSTRUCTION_MARKDOWN;
  }

  const defaultProject = readGitlabDefaultProjectId(adapterConfig);
  const extra = defaultProject
    ? [
        "",
        "**Default GitLab `projectId` for this agent:** When a tool requires `projectId` and the task does not imply another project, prefer:",
        `\`${defaultProject}\``,
      ].join("\n")
    : "";

  return basePrompt + extra;
}
