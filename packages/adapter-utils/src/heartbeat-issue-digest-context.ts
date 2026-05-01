/**
 * Server-injected markdown block with issue/wake context for local adapter stdin.
 * See `server/src/services/heartbeat-issue-digest.ts` (buildPaperclipHeartbeatIssueDigest).
 */
export function heartbeatIssueDigestFromContext(context: Record<string, unknown> | null | undefined): string {
  if (!context || typeof context !== "object") return "";
  const raw = context["paperclipHeartbeatIssueDigest"];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "";
}
