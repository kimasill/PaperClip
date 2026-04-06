/**
 * Per-agent Obsidian Brain workflow instructions (adapterConfig.paperclipObsidianBrainWorkflowPrompt).
 * Browser-safe — no Node built-ins.
 */

export const PAPERCLIP_OBSIDIAN_BRAIN_WORKFLOW_PROMPT_KEY = "paperclipObsidianBrainWorkflowPrompt";

/** When true, agent automatically saves/recalls knowledge every run for token efficiency. */
export const OBSIDIAN_BRAIN_AUTO_KNOWLEDGE_KEY = "paperclipObsidianBrainAutoKnowledge";

/** Injected into the heartbeat run context when the agent opts in and the plugin is available. */
export const CONTEXT_OBSIDIAN_BRAIN_WORKFLOW_PROMPT_KEY = "paperclipObsidianBrainWorkflowPromptMarkdown";

export function readPaperclipObsidianBrainWorkflowPrompt(config: Record<string, unknown>): boolean {
  const v = config[PAPERCLIP_OBSIDIAN_BRAIN_WORKFLOW_PROMPT_KEY];
  return v === true || v === "true";
}

export function readObsidianBrainAutoKnowledge(config: Record<string, unknown>): boolean {
  const v = config[OBSIDIAN_BRAIN_AUTO_KNOWLEDGE_KEY];
  return v === true || v === "true";
}

export function paperclipObsidianBrainWorkflowPromptFromContext(context: Record<string, unknown>): string {
  const raw = context[CONTEXT_OBSIDIAN_BRAIN_WORKFLOW_PROMPT_KEY];
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Compact workflow block appended to the agent prompt when enabled (passive mode).
 * Tools are namespaced at runtime (e.g. paperclip.obsidian-brain:obsidian_brain.write).
 */
export const PAPERCLIP_OBSIDIAN_BRAIN_WORKFLOW_INSTRUCTION_MARKDOWN = [
  "## Paperclip — Obsidian Brain workflow (this agent)",
  "",
  "You may have plugin tools for Obsidian Brain (namespaced `obsidian_brain.*` / `paperclip.obsidian-brain:*`). **Call them only when useful** — not every turn.",
  "",
  "**Write & structure:** When you produce durable technical notes, decisions, reusable snippets, or specs worth keeping, save concise Markdown via the appropriate write tool. Prefer small, linkable files over one giant note. Connect related notes with `[[Note Title]]` wikilinks.",
  "",
  "**Read & recall:** For substantive work, consider listing your brain folder first, then reading only notes that match the task. If the vault is large, use **`obsidian_brain.semantic_search`** for a few relevant chunks before opening many full files. Avoid bulk-reading everything; stay within token budget.",
  "",
  "**Shared / common content:** Team-wide digests and references live under `common/` (read with the `common/` path prefix). Use `write_common` only when your plugin role allows it. If something should be shared but you cannot write `common/`, put essentials in an issue comment or hand off to an orchestrator agent who can update `common/`.",
  "",
  "**Do not** use generic filesystem tools against the configured Obsidian vault path; use the plugin tools only.",
  "",
  "**GitLab issue + work log:** When you open a GitLab issue for a Paperclip task (via `gitlab.create_issue` with `paperclipIssueId`), also append one line to your brain work log (e.g. `work-log/YYYY-MM-DD.md` or `daily/YYYY-MM-DD.md`) with the GitLab URL, Paperclip issue id, and a short summary — so Obsidian keeps a durable trace alongside the board.",
].join("\n");

/**
 * Auto-knowledge mode: agent MUST recall context at start and save structured knowledge at end.
 * Dramatically reduces token waste by eliminating re-discovery across heartbeat runs.
 */
export const PAPERCLIP_OBSIDIAN_BRAIN_AUTO_KNOWLEDGE_INSTRUCTION_MARKDOWN = [
  "## Paperclip — Obsidian Brain (AUTO-KNOWLEDGE mode)",
  "",
  "This agent has **automatic knowledge management** enabled. Follow this protocol **every run**:",
  "",
  "### Phase 1: RECALL (first 2-3 tool calls of every run)",
  "",
  "1. `obsidian_brain.list` (scope: agent) — scan your brain folder for existing notes.",
  "2. Read **only** notes matching the current task (by title/topic) via `obsidian_brain.read`. Read at most 2-3 files; skip if nothing matches.",
  "3. `obsidian_brain.read` on `_role-context.md` if it exists — this is your pre-built role briefing from the previous run. Treat its contents as authoritative context so you do NOT need to re-discover your role, environment, or recurring patterns.",
  "4. Optionally `obsidian_brain.list` (scope: common) for shared team knowledge if the task requires cross-agent context.",
  "5. When the vault is large or noisy, prefer **`obsidian_brain.semantic_search`** (scope `agent`, `common`, or `both`) with a tight natural-language query to retrieve a few relevant chunks — instead of reading many full `.md` files. Run **`obsidian_brain.reindex_semantic`** after bulk imports or if search feels stale.",
  "",
  "### Phase 2: WORK (normal task execution)",
  "",
  "During work, save immediately when you discover or produce:",
  "- Technical decisions or architecture choices → `decisions/YYYY-MM-DD-<topic>.md`",
  "- API references, config patterns, or reusable snippets → `references/<topic>.md`",
  "- Error resolutions or debugging steps → `troubleshooting/<topic>.md`",
  "",
  "Use `[[Note Title]]` wikilinks to connect related notes. Keep each note small and focused.",
  "",
  "### Phase 3: HANDOFF (last 1-2 tool calls before run ends)",
  "",
  "1. **Update `_role-context.md`** with a structured briefing for your next run:",
  "",
  "```markdown",
  "# Role Context (auto-updated)",
  "## Identity",
  "- Agent: {{name}}, Role: {{role}}",
  "- Current focus: <1-line summary of active work>",
  "## Active tasks",
  "- <task 1>: <status, branch, blockers>",
  "- <task 2>: ...",
  "## Environment",
  "- Workspace: <cwd>, key repos/tools",
  "- Credentials/config notes: <what's set up>",
  "## Key decisions this run",
  "- <decision 1>: <rationale>",
  "## Next run TODO",
  "- <what to do first next time>",
  "```",
  "",
  "2. If a GitLab issue was created/updated, append to `work-log/YYYY-MM-DD.md`.",
  "",
  "### Token-efficient patterns",
  "",
  "- The `_role-context.md` recall eliminates the need to re-read AGENTS.md, discover capabilities, or probe the environment each run.",
  "- Do NOT bulk-read your entire brain folder. The list → selective read pattern is mandatory.",
  "- Write notes incrementally during work, not as one big dump at the end.",
  "- `common/` reads are optional — only when the task explicitly needs cross-agent context.",
  "",
  "**Do not** use generic filesystem tools against the configured Obsidian vault path; use the plugin tools only.",
].join("\n");
