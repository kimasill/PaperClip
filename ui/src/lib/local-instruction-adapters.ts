/**
 * Local CLI adapters that support managed instruction bundles (AGENTS.md, HEARTBEAT.md, etc.)
 * in the agent detail UI. Keep in sync with server routes that map these types to instructions paths.
 */
export const ENABLED_LOCAL_ADAPTER_TYPES = new Set([
  "claude_local",
  "codex_local",
  "gemini_local",
  "opencode_local",
  "pi_local",
  "cursor",
  "hermes_local",
]);

export function supportsInstructionsBundle(adapterType: string): boolean {
  return ENABLED_LOCAL_ADAPTER_TYPES.has(adapterType);
}
