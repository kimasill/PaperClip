import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { pluginCompanySettings, plugins } from "@paperclipai/db";
import {
  PAPERCLIP_OBSIDIAN_BRAIN_WORKFLOW_INSTRUCTION_MARKDOWN,
  PAPERCLIP_OBSIDIAN_BRAIN_AUTO_KNOWLEDGE_INSTRUCTION_MARKDOWN,
  readPaperclipObsidianBrainWorkflowPrompt,
  readObsidianBrainAutoKnowledge,
} from "@paperclipai/adapter-utils";

const OBSIDIAN_BRAIN_PLUGIN_KEY = "paperclip.obsidian-brain";

/**
 * Markdown to append to the agent run prompt when this agent opts in and Obsidian Brain is usable for the company.
 * Either "Inject workflow" and/or "Auto-knowledge" may be enabled — both gate tool access in `plugins.ts`, so prompt
 * injection must align: auto-knowledge alone must still receive the AUTO-KNOWLEDGE instruction block.
 */
export async function resolveObsidianBrainWorkflowPromptForRun(
  db: Db,
  companyId: string,
  adapterConfig: Record<string, unknown>,
): Promise<string | null> {
  const workflowOn = readPaperclipObsidianBrainWorkflowPrompt(adapterConfig);
  const autoKnowledge = readObsidianBrainAutoKnowledge(adapterConfig);
  if (!workflowOn && !autoKnowledge) return null;

  const rows = await db
    .select({ id: plugins.id, status: plugins.status })
    .from(plugins)
    .where(eq(plugins.pluginKey, OBSIDIAN_BRAIN_PLUGIN_KEY))
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

  return autoKnowledge
    ? PAPERCLIP_OBSIDIAN_BRAIN_AUTO_KNOWLEDGE_INSTRUCTION_MARKDOWN
    : PAPERCLIP_OBSIDIAN_BRAIN_WORKFLOW_INSTRUCTION_MARKDOWN;
}
