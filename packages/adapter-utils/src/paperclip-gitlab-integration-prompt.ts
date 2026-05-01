/**
 * Per-agent GitLab integration (adapterConfig.paperclipGitlabIntegrationEnabled).
 * Browser-safe — no Node built-ins.
 */

export const PAPERCLIP_GITLAB_INTEGRATION_ENABLED_KEY = "paperclipGitlabIntegrationEnabled";

/** Optional default GitLab project id or URL-encoded path for tool calls. */
export const GITLAB_DEFAULT_PROJECT_ID_KEY = "gitlabDefaultProjectId";

/** When true, agent automatically creates/syncs GitLab issues for every new Paperclip task. */
export const GITLAB_AUTO_ISSUE_SYNC_KEY = "paperclipGitlabAutoIssueSync";

/** Injected into the heartbeat run context when the agent opts in and Git Provider is usable. */
export const CONTEXT_GITLAB_INTEGRATION_PROMPT_KEY = "paperclipGitlabIntegrationPromptMarkdown";

export function readPaperclipGitlabIntegrationEnabled(config: Record<string, unknown>): boolean {
  const v = config[PAPERCLIP_GITLAB_INTEGRATION_ENABLED_KEY];
  return v === true || v === "true";
}

export function readGitlabDefaultProjectId(config: Record<string, unknown>): string | null {
  const v = config[GITLAB_DEFAULT_PROJECT_ID_KEY];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function readGitlabAutoIssueSync(config: Record<string, unknown>): boolean {
  const v = config[GITLAB_AUTO_ISSUE_SYNC_KEY];
  return v === true || v === "true";
}

export function paperclipGitlabIntegrationPromptFromContext(context: Record<string, unknown>): string {
  const raw = context[CONTEXT_GITLAB_INTEGRATION_PROMPT_KEY];
  return typeof raw === "string" ? raw.trim() : "";
}

const GITLAB_COMMON_PREAMBLE = [
  "**Auth & env:** From the workspace cwd run `source .paperclip/runtime-env.sh` so `PAPERCLIP_API_KEY`, `PAPERCLIP_API_URL`, `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, and `PAPERCLIP_RUN_ID` are set. Send header `Authorization: Bearer $PAPERCLIP_API_KEY` and `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` on mutating calls.",
  "",
  "**Discover tools:** `GET $PAPERCLIP_API_URL/api/plugins/tools` — you only need entries whose `name` starts with `paperclip.git-provider:gitlab.`",
  "",
  "**Execute a tool:** `POST $PAPERCLIP_API_URL/api/plugins/tools/execute` with JSON body:",
  "`{ \"tool\": \"<namespaced tool>\", \"parameters\": { ... }, \"runContext\": { \"agentId\": \"$PAPERCLIP_AGENT_ID\", \"runId\": \"$PAPERCLIP_RUN_ID\", \"companyId\": \"$PAPERCLIP_COMPANY_ID\", \"projectId\": \"<Paperclip project UUID from issue/workspace context>\" } }`",
].join("\n");

const GITLAB_DELIVERY_PIPELINE = [
  "### Delivery pipeline — treat as one job (do not stop halfway)",
  "",
  "1. **Edit code** in the configured workspace cwd.",
  "2. **Publish the branch with local git via your Shell tool** (when the adapter exposes terminal/shell access — e.g. Cursor): run `git status`, then `git checkout -b <branch>` (or use an existing branch), `git add …`, `git commit -m \"…\"`, and `git push -u origin <branch>`. Fix auth/remotes yourself; do not skip push and jump straight to MR.",
  "3. **Open the MR** with `gitlab.create_merge_request` (`sourceBranch`, `targetBranch`, `projectId`, `title`, etc.).",
  "",
  "**Fallback when Shell/git is unavailable:** use plugin tools `gitlab.create_branch` and `gitlab.create_commit` (Commits API) instead of local `git push`, then `gitlab.create_merge_request`.",
  "",
  "Pass `paperclipIssueId` (this task's Paperclip issue id) when you create the MR so merge-approval webhooks can resolve Paperclip approvals (Git Provider plugin + GitLab webhook must be configured on the instance).",
  "",
  "**CI / review:** Use `gitlab.get_pipeline_status`, `gitlab.list_project_pipelines`, or `gitlab.list_mr_discussions` when the task depends on pipeline or MR feedback.",
].join("\n");

/**
 * Base workflow block (passive mode); server may append default project hints.
 * Tools are namespaced `paperclip.git-provider:gitlab.*` and executed via the Paperclip API.
 */
export const PAPERCLIP_GITLAB_INTEGRATION_INSTRUCTION_MARKDOWN = [
  "## Paperclip — GitLab integration (this agent)",
  "",
  "You may call **GitLab** tools from the Git Provider plugin via the Paperclip API (not raw GitLab REST from this process unless needed). Tool names are like `paperclip.git-provider:gitlab.create_merge_request`.",
  "",
  GITLAB_COMMON_PREAMBLE,
  "",
  GITLAB_DELIVERY_PIPELINE,
  "",
  "**Issues (Paperclip → GitLab):** To register **this task** on GitLab's issue tracker, call `gitlab.create_issue` with **`paperclipIssueId` set to the current Paperclip issue UUID** (same id you pass for MR approval sync). The plugin stores a `gitlab-issue-link` entity, posts a link on the Paperclip issue, and adds a small footer to the GitLab description. For follow-ups use `gitlab.update_issue` / `gitlab.create_issue_note`. When Paperclip work is done and upstream should close, use `stateEvent: \"close\"` on the GitLab issue if applicable.",
].join("\n");

/**
 * Auto-issue-sync mode: agent MUST create/sync GitLab issues for every task.
 * Reduces token waste by making the behavior mandatory rather than optional.
 */
export const PAPERCLIP_GITLAB_AUTO_ISSUE_SYNC_INSTRUCTION_MARKDOWN = [
  "## Paperclip — GitLab integration (AUTO-SYNC mode)",
  "",
  "This agent has **automatic GitLab issue synchronization** enabled. You **MUST** follow these rules:",
  "",
  "### Mandatory issue sync (do this at the START of every run with a Paperclip issue)",
  "",
  "1. If the current Paperclip issue does **not** already have a linked GitLab issue, **immediately** call `gitlab.create_issue` with `paperclipIssueId` set to the Paperclip issue UUID. Use a concise title and structured description.",
  "2. If a linked GitLab issue already exists (check `gitlab.list_issues` with the Paperclip UUID label or the issue-link entity), **update** it with current status via `gitlab.update_issue` or `gitlab.create_issue_note`.",
  "3. When you complete work on an issue, add a closing note and set `stateEvent: \"close\"` if the work is done.",
  "",
  "### Mandatory MR sync",
  "",
  "When code changes are made, always create a GitLab MR with `paperclipIssueId` so approval webhooks work.",
  "",
  GITLAB_COMMON_PREAMBLE,
  "",
  GITLAB_DELIVERY_PIPELINE,
  "",
  "### Token-efficient patterns",
  "",
  "- Do NOT re-discover tools every run; cache tool names across turns in your session.",
  "- Use structured, minimal issue descriptions — bullet points, not prose.",
  "- Batch issue updates: combine status + notes into a single `create_issue_note` call instead of multiple small updates.",
  "- For MR descriptions, reference the Paperclip issue UUID and keep the body under 500 chars.",
].join("\n");
