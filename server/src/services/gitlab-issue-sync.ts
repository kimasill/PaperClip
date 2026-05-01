/**
 * GitLab Issue Auto-Sync — server-side asynchronous issue synchronization.
 *
 * When enabled on the Git Provider plugin instance config (`autoSyncIssues: true`),
 * Paperclip issue lifecycle events (create, status change) automatically trigger
 * GitLab issue creation/updates **without** consuming agent tokens.
 *
 * The sync uses the same `toolDispatcher.executeTool` path as agent-initiated calls,
 * but with a synthetic system run context. This keeps the plugin worker logic
 * (token resolution, entity linking, activity logging) identical.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { pluginCompanySettings, plugins, pluginConfig, pluginEntities } from "@paperclipai/db";
import type { PluginToolDispatcher } from "./plugin-tool-dispatcher.js";
import { logger } from "../middleware/logger.js";

const GIT_PROVIDER_PLUGIN_KEY = "paperclip.git-provider";

const SYSTEM_AGENT_ID = "00000000-0000-0000-0000-000000000000";
const SYSTEM_RUN_ID = "00000000-0000-0000-0000-000000000000";
const SYSTEM_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

const log = logger.child({ service: "gitlab-issue-sync" });

interface IssueSnapshot {
  id: string;
  companyId: string;
  title: string;
  identifier: string | null;
  description: string | null;
  status: string;
  priority: string | null;
  assigneeAgentId: string | null;
}

interface SyncConfig {
  autoSyncIssues: boolean;
  defaultGitlabProjectId: string | null;
}

async function resolveGitProviderConfig(
  db: Db,
  companyId: string,
): Promise<{ pluginDbId: string; config: SyncConfig } | null> {
  const pluginRows = await db
    .select({ id: plugins.id, status: plugins.status })
    .from(plugins)
    .where(eq(plugins.pluginKey, GIT_PROVIDER_PLUGIN_KEY))
    .limit(1);

  const plugin = pluginRows[0];
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

  const raw = (configRows[0]?.configJson ?? {}) as Record<string, unknown>;
  const autoSyncIssues = raw.autoSyncIssues === true || raw.autoSyncIssues === "true";
  if (!autoSyncIssues) return null;

  const defaultGitlabProjectId =
    typeof raw.defaultGitlabProjectId === "string" && raw.defaultGitlabProjectId.trim()
      ? raw.defaultGitlabProjectId.trim()
      : null;

  return {
    pluginDbId: plugin.id,
    config: { autoSyncIssues, defaultGitlabProjectId },
  };
}

function buildIssueDescription(issue: IssueSnapshot): string {
  const lines: string[] = [];
  if (issue.description) {
    lines.push(issue.description);
    lines.push("");
  }
  lines.push("---");
  lines.push(`**Paperclip issue:** \`${issue.id}\``);
  if (issue.identifier) lines.push(`**Identifier:** ${issue.identifier}`);
  if (issue.priority) lines.push(`**Priority:** ${issue.priority}`);
  lines.push(`**Status:** ${issue.status}`);
  return lines.join("\n");
}

const STATUS_TO_GITLAB_STATE: Record<string, string | undefined> = {
  done: "close",
  cancelled: "close",
  todo: "reopen",
  in_progress: "reopen",
  blocked: undefined,
};

export interface GitLabIssueSyncService {
  onIssueCreated(issue: IssueSnapshot): void;
  onIssueStatusChanged(issue: IssueSnapshot, previousStatus: string): void;
}

export function gitlabIssueSyncService(
  db: Db,
  toolDispatcher: PluginToolDispatcher | null,
): GitLabIssueSyncService {

  async function syncCreateIssue(issue: IssueSnapshot): Promise<void> {
    if (!toolDispatcher) return;

    const resolved = await resolveGitProviderConfig(db, issue.companyId);
    if (!resolved) return;

    const projectId = resolved.config.defaultGitlabProjectId;
    if (!projectId) {
      log.debug({ issueId: issue.id }, "gitlab-issue-sync: no defaultGitlabProjectId configured, skipping");
      return;
    }

    const toolName = `${GIT_PROVIDER_PLUGIN_KEY}:gitlab.create_issue`;
    const tool = toolDispatcher.getTool(toolName);
    if (!tool) {
      log.debug({ issueId: issue.id }, "gitlab-issue-sync: gitlab.create_issue tool not registered");
      return;
    }

    const title = issue.identifier
      ? `[${issue.identifier}] ${issue.title}`
      : issue.title;

    try {
      const result = await toolDispatcher.executeTool(
        toolName,
        {
          projectId,
          title,
          description: buildIssueDescription(issue),
          paperclipIssueId: issue.id,
        },
        {
          agentId: issue.assigneeAgentId ?? SYSTEM_AGENT_ID,
          runId: SYSTEM_RUN_ID,
          companyId: issue.companyId,
          projectId: SYSTEM_PROJECT_ID,
        },
      );

      if (result.result.error) {
        log.warn({ issueId: issue.id, error: result.result.error }, "gitlab-issue-sync: create failed");
      } else {
        log.info({ issueId: issue.id, content: result.result.content }, "gitlab-issue-sync: issue created");
      }
    } catch (err) {
      log.error({ err, issueId: issue.id }, "gitlab-issue-sync: create_issue threw");
    }
  }

  async function syncStatusChange(issue: IssueSnapshot, previousStatus: string): Promise<void> {
    if (!toolDispatcher) return;

    const resolved = await resolveGitProviderConfig(db, issue.companyId);
    if (!resolved) return;

    const projectId = resolved.config.defaultGitlabProjectId;
    if (!projectId) return;

    const stateEvent = STATUS_TO_GITLAB_STATE[issue.status];

    const noteToolName = `${GIT_PROVIDER_PLUGIN_KEY}:gitlab.create_issue_note`;
    const noteTool = toolDispatcher.getTool(noteToolName);

    const noteBody = `Status changed: **${previousStatus}** → **${issue.status}** (synced from Paperclip)`;

    const updateToolName = `${GIT_PROVIDER_PLUGIN_KEY}:gitlab.update_issue`;
    const updateTool = stateEvent ? toolDispatcher.getTool(updateToolName) : null;

    const runCtx = {
      agentId: issue.assigneeAgentId ?? SYSTEM_AGENT_ID,
      runId: SYSTEM_RUN_ID,
      companyId: issue.companyId,
      projectId: SYSTEM_PROJECT_ID,
    };

    try {
      if (noteTool) {
        const entity = await findGitlabIssueLinkEntity(db, resolved.pluginDbId, issue.id);
        if (!entity) {
          log.debug({ issueId: issue.id }, "gitlab-issue-sync: no linked GitLab issue found, skipping status sync");
          return;
        }

        await toolDispatcher.executeTool(
          noteToolName,
          { projectId, issueIid: entity.issueIid, body: noteBody },
          runCtx,
        );

        if (updateTool && stateEvent) {
          await toolDispatcher.executeTool(
            updateToolName,
            { projectId, issueIid: entity.issueIid, stateEvent },
            runCtx,
          );
        }

        log.info(
          { issueId: issue.id, status: issue.status, stateEvent },
          "gitlab-issue-sync: status synced",
        );
      }
    } catch (err) {
      log.error({ err, issueId: issue.id }, "gitlab-issue-sync: status sync threw");
    }
  }

  return {
    onIssueCreated(issue: IssueSnapshot) {
      void syncCreateIssue(issue).catch((err) =>
        log.error({ err, issueId: issue.id }, "gitlab-issue-sync: unhandled error in onIssueCreated"),
      );
    },
    onIssueStatusChanged(issue: IssueSnapshot, previousStatus: string) {
      void syncStatusChange(issue, previousStatus).catch((err) =>
        log.error({ err, issueId: issue.id }, "gitlab-issue-sync: unhandled error in onIssueStatusChanged"),
      );
    },
  };
}

async function findGitlabIssueLinkEntity(
  db: Db,
  pluginDbId: string,
  paperclipIssueId: string,
): Promise<{ issueIid: number } | null> {
  const rows = await db
    .select({ data: pluginEntities.data })
    .from(pluginEntities)
    .where(
      and(
        eq(pluginEntities.pluginId, pluginDbId),
        eq(pluginEntities.entityType, "gitlab-issue-link"),
      ),
    )
    .limit(100);

  for (const row of rows) {
    const d = row.data as Record<string, unknown> | null;
    if (d && d.paperclipIssueId === paperclipIssueId && typeof d.issueIid === "number") {
      return { issueIid: d.issueIid };
    }
  }
  return null;
}
