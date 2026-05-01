/**
 * Default prompt template when an agent has no `promptTemplate` configured.
 * Kept minimal to reduce per-heartbeat token cost.
 */
export const DEFAULT_LOCAL_ADAPTER_PROMPT_TEMPLATE = `Agent {{agent.id}} ({{agent.name}}). PAPERCLIP_* env vars are set. Use PAPERCLIP_API_KEY for Bearer auth.

If the stdin prompt begins with a "## Paperclip heartbeat — work order" block, treat that block as the authoritative scope for this run (issue body, wake reason, trigger comment).
If Bash lacks PAPERCLIP_API_KEY: source .paperclip/runtime-env.sh from workspace cwd.
AGENT_HOME instructions: $AGENT_HOME/instructions/. Domain work: workspace cwd (not AGENT_HOME).
Hire/split via paperclip-create-agent when work needs another role. paperclip skill for coordination only.`;
