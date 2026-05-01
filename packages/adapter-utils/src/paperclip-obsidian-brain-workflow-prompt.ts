/**
 * Obsidian Brain workflow / auto-knowledge (adapterConfig flags).
 * Browser-safe — no Node built-ins.
 */

export const PAPERCLIP_OBSIDIAN_BRAIN_WORKFLOW_PROMPT_KEY = "paperclipObsidianBrainWorkflowPrompt";

export const OBSIDIAN_BRAIN_AUTO_KNOWLEDGE_KEY = "paperclipObsidianBrainAutoKnowledge";

export function readPaperclipObsidianBrainWorkflowPrompt(config: Record<string, unknown>): boolean {
  const v = config[PAPERCLIP_OBSIDIAN_BRAIN_WORKFLOW_PROMPT_KEY];
  return v === true || v === "true";
}

export function readObsidianBrainAutoKnowledge(config: Record<string, unknown>): boolean {
  const v = config[OBSIDIAN_BRAIN_AUTO_KNOWLEDGE_KEY];
  return v === true || v === "true";
}

const WORKFLOW_BODY = [
  "## Paperclip — Obsidian Brain (this agent)",
  "",
  "When **Obsidian Brain** tools (`obsidian_brain.*`) are available, you may read/write Markdown under your agent folder and read shared `common/` notes.",
  "",
  "**Efficient use:** `list` (agent or common) → selectively `read` one or two notes → `write` / `append` durable facts (decisions, references, troubleshooting). Prefer wikilinks `[[Note]]` between related notes.",
  "",
  "**common/:** Readable by all agents; `write_common` only if your role allows orchestrator-style shared updates.",
].join("\n");

const AUTO_KNOWLEDGE_BODY = [
  "## Paperclip — Obsidian Brain (AUTO-KNOWLEDGE mode)",
  "",
  "You **must** treat the brain as mandatory state for every run:",
  "",
  "1. **Start** — Read `_role-context.md` under your agent folder first; then optionally read only notes relevant to the current task.",
  "2. **During** — Persist technical decisions (`decisions/`), API notes (`references/`), and fixes (`troubleshooting/`) as you go.",
  "3. **End** — Update `_role-context.md` and append a short entry to `work-log/YYYY-MM-DD.md` so the next run avoids rediscovery.",
  "",
  WORKFLOW_BODY,
].join("\n");

export const PAPERCLIP_OBSIDIAN_BRAIN_WORKFLOW_INSTRUCTION_MARKDOWN = WORKFLOW_BODY;

export const PAPERCLIP_OBSIDIAN_BRAIN_AUTO_KNOWLEDGE_INSTRUCTION_MARKDOWN = AUTO_KNOWLEDGE_BODY;
