import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclip.linear-bridge";
export const PLUGIN_VERSION = "0.1.0";

/** UUID string for `company_secrets.id` (secret-ref fields). Not env:VAR or raw tokens. */
const COMPANY_SECRET_ID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Linear Webhook Bridge",
  description:
    "Verifies Linear-Signature, enqueues Issue events, and runs a Paperclip agent sequentially (user prompt only; system prompt unchanged).",
  author: "Paperclip",
  categories: ["automation", "connector"],
  capabilities: [
    "webhooks.receive",
    "secrets.read-ref",
    "plugin.state.read",
    "plugin.state.write",
    "agents.read",
    "agent.sessions.create",
    "agent.sessions.send",
    "agent.sessions.close",
    "activity.log.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      webhookSigningSecretRef: {
        type: "string",
        title: "Linear webhook signing secret ref",
        description:
          "Company secret row id (UUID) whose value is the Linear webhook signing secret (used to verify Linear-Signature). Do not paste the raw secret here — store it under Settings → Company secrets and paste its id.",
        format: "secret-ref",
        pattern: COMPANY_SECRET_ID_PATTERN,
      },
      companyId: {
        type: "string",
        title: "Company ID",
        description: "Company scope for the target agent.",
      },
      agentId: {
        type: "string",
        title: "Agent ID",
        description:
          "Optional. Agent that receives Linear work via session user prompt only. If omitted, the bridge picks the company CEO agent when present, otherwise the first non-terminated agent.",
      },
      promptTemplate: {
        type: "string",
        title: "User prompt template",
        description:
          "Template for the user message only. Placeholders: {{identifier}}, {{title}}, {{description}}, {{url}}, {{issueId}}, {{team}}, {{state}}, {{priority}}, {{linearEvent}}, {{action}}, {{deliveryId}}.",
        default:
          "Linear 작업 요청\n\n- 티켓: {{identifier}}\n- 제목: {{title}}\n- 상태: {{state}}\n- 이벤트: {{linearEvent}} / {{action}}\n- URL: {{url}}\n\n설명:\n{{description}}\n\n위 작업을 수행해 주세요.",
      },
      issueActions: {
        type: "array",
        title: "Issue actions to handle",
        description: "Webhook payload action values to enqueue (e.g. create, update).",
        items: { type: "string" },
        default: ["create"],
      },
      linearEventTypes: {
        type: "array",
        title: "Linear-Event types",
        description: "If non-empty, only these Linear-Event header values are handled (e.g. Issue).",
        items: { type: "string" },
        default: ["Issue"],
      },
      replayWindowMs: {
        type: "number",
        title: "Webhook timestamp replay window (ms)",
        description: "Max |now - webhookTimestamp| for acceptance (Linear recommends ~60s).",
        default: 120000,
      },
      taskTimeoutMs: {
        type: "number",
        title: "Per-task timeout (ms)",
        description: "Max time to wait for agent session completion before failing the queue item.",
        default: 3600000,
      },
    },
    required: ["webhookSigningSecretRef", "companyId"],
  },
  webhooks: [
    {
      endpointKey: "linear",
      displayName: "Linear Webhooks",
      description: "Receives application/json POSTs from Linear (Linear-Signature verification).",
    },
  ],
};

export default manifest;
