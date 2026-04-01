import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclip.slack-commands";
export const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Slack Commands",
  description: "Receives Slack slash commands and dispatches work to Paperclip agents.",
  author: "Paperclip",
  categories: ["automation", "connector"],
  capabilities: [
    "webhooks.receive",
    "secrets.read-ref",
    "http.outbound",
    "agents.invoke",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      signingSecretRef: {
        type: "string",
        title: "Slack signing secret ref",
        description: "Secret ref used to verify X-Slack-Signature (e.g. secret://company/... or env://...).",
      },
      companyId: {
        type: "string",
        title: "Default companyId",
        description: "Company scope used when invoking an agent from Slack.",
      },
      agentId: {
        type: "string",
        title: "Default agentId",
        description: "Agent to invoke for incoming Slack commands.",
      },
      projectId: {
        type: "string",
        title: "Default projectId (optional)",
      },
      commandPrefix: {
        type: "string",
        title: "Command prefix (optional)",
        description: "If set, only commands starting with this prefix are accepted (e.g. '@Engineer').",
        default: "",
      },
      allowChannels: {
        type: "array",
        title: "Allowed channel IDs (optional)",
        description: "If provided, only these Slack channel IDs can trigger runs.",
        items: { type: "string" },
        default: [],
      },
    },
    required: ["signingSecretRef", "companyId", "agentId"],
  },
  webhooks: [
    {
      endpointKey: "slash",
      displayName: "Slack Slash Command",
      description: "Slack slash command receiver (application/x-www-form-urlencoded).",
    },
  ],
};

export default manifest;

