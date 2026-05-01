/** Max chars for issue description embedded in the adapter stdin digest (token guard). */
export const HEARTBEAT_ISSUE_DIGEST_MAX_DESCRIPTION_CHARS = 12_000;
/** Max chars for trigger comment body in the digest. */
export const HEARTBEAT_ISSUE_DIGEST_MAX_COMMENT_CHARS = 8_000;

export type HeartbeatIssueDigestIssue = {
  identifier: string | null;
  title: string | null;
  description: string | null;
};

export type BuildPaperclipHeartbeatIssueDigestInput = {
  runId: string;
  invocationSource: string;
  triggerDetail: string | null;
  wakeReason: string | null;
  taskId: string | null;
  issueId: string | null;
  wakeCommentId: string | null;
  issue: HeartbeatIssueDigestIssue | null;
  triggerCommentBody: string | null;
};

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function truncateForDigest(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…[truncated]`;
}

/**
 * Markdown block for local adapter stdin so the model sees explicit work context
 * (issue body, wake reason, optional trigger comment) instead of only env vars.
 */
export function buildPaperclipHeartbeatIssueDigest(input: BuildPaperclipHeartbeatIssueDigestInput): string {
  const hasWork =
    input.issue !== null ||
    nonEmpty(input.issueId) ||
    nonEmpty(input.wakeReason) ||
    nonEmpty(input.wakeCommentId) ||
    nonEmpty(input.taskId);

  if (!hasWork) return "";

  const lines: string[] = [];
  lines.push("## Paperclip heartbeat — work order");
  lines.push("");
  lines.push(
    "This is a Paperclip-orchestrated run. **Do not** stop after asking what to do or waiting for a user message. Follow your role instructions (`AGENTS.md`, `HEARTBEAT` when applicable): use the API/inbox as needed, do the work, update the issue, then exit appropriately.",
  );
  lines.push("");
  lines.push("### Run");
  lines.push(`- runId: \`${input.runId}\``);
  lines.push(`- invocationSource: ${input.invocationSource}`);
  if (nonEmpty(input.triggerDetail)) lines.push(`- triggerDetail: ${input.triggerDetail}`);
  if (nonEmpty(input.wakeReason)) lines.push(`- wakeReason: \`${input.wakeReason}\``);
  if (nonEmpty(input.taskId)) lines.push(`- taskId: \`${input.taskId}\``);
  if (nonEmpty(input.issueId)) lines.push(`- issueId: \`${input.issueId}\``);
  if (nonEmpty(input.wakeCommentId)) lines.push(`- wakeCommentId: \`${input.wakeCommentId}\``);

  if (input.issue) {
    const { identifier, title, description } = input.issue;
    lines.push("");
    lines.push("### Issue");
    if (nonEmpty(identifier)) lines.push(`- identifier: \`${identifier}\``);
    if (nonEmpty(title)) lines.push(`- title: ${title}`);
    if (nonEmpty(description)) {
      lines.push("- description:");
      lines.push("");
      lines.push(truncateForDigest(description, HEARTBEAT_ISSUE_DIGEST_MAX_DESCRIPTION_CHARS));
    }
  } else if (nonEmpty(input.issueId)) {
    lines.push("");
    lines.push("### Issue");
    lines.push(`- issueId: \`${input.issueId}\` (issue row was not found or not loaded)`);
  }

  if (nonEmpty(input.wakeCommentId) || nonEmpty(input.triggerCommentBody)) {
    lines.push("");
    lines.push("### Trigger comment");
    if (nonEmpty(input.triggerCommentBody)) {
      lines.push(truncateForDigest(input.triggerCommentBody!, HEARTBEAT_ISSUE_DIGEST_MAX_COMMENT_CHARS));
    } else {
      lines.push(`(comment id \`${input.wakeCommentId}\` — body not loaded)`);
    }
  }

  return lines.join("\n");
}
