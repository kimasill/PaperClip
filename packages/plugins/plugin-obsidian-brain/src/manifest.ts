import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclip.obsidian-brain";
export const PLUGIN_VERSION = "0.2.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Obsidian Brain",
  description:
    "Read/write Markdown notes in an Obsidian vault under PaperclipBrain/{companyId}/agents/{agentId} and shared common/ notes. Optional per-agent prompt injection: enable “Obsidian Brain workflow (prompt)” on each agent’s Configuration tab (adapterConfig.paperclipObsidianBrainWorkflowPrompt).",
  author: "Paperclip",
  categories: ["automation", "connector"],
  capabilities: ["agent.tools.register", "activity.log.write"],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      vaultRoot: {
        type: "string",
        title: "Obsidian Vault root (absolute path)",
        description:
          "Absolute path to your Obsidian Vault on the Paperclip host (the folder Obsidian opens as a vault). Relative paths resolve against the server process working directory — avoid them. Do not point this at …/.paperclip/…/projects/… unless you intentionally want a checkout-local mirror instead of your real vault.",
      },
      brainSubdir: {
        type: "string",
        title: "Brain subdirectory",
        description: "Folder inside the vault for Paperclip data (default: PaperclipBrain).",
        default: "PaperclipBrain",
      },
      allowAllAgentsCommonWrite: {
        type: "boolean",
        title: "Allow all agents to write common/",
        description:
          "When enabled, every agent in this company may use obsidian_brain.write_common without listing IDs below. When disabled, only orchestratorAgentIds may write common/.",
        default: false,
      },
      orchestratorAgentIds: {
        type: "string",
        title: "Orchestrator agent IDs",
        description:
          "Comma-separated agent UUIDs allowed to write to company common/ (write_common). Ignored for allowlisting when “Allow all agents to write common/” is on; leave empty only if that option is on or you intend to block all common writes.",
        default: "",
      },
      enforceMdExtension: {
        type: "boolean",
        title: "Restrict paths to .md files",
        default: true,
      },
      maxReadBytes: {
        type: "number",
        title: "Max bytes per read",
        default: 262144,
      },
      semanticSearchEnabled: {
        type: "boolean",
        title: "Enable semantic search (RAG)",
        description:
          "When enabled, agents can call obsidian_brain.semantic_search and obsidian_brain.reindex_semantic. Uses local embeddings (@xenova/transformers) and a JSON index under PaperclipBrain/{companyId}/.semantic-index/.",
        default: true,
      },
      maxChunkChars: {
        type: "number",
        title: "Max characters per indexed chunk",
        description: "Paragraphs are merged/split to stay under this size for embedding.",
        default: 720,
      },
      embeddingModelId: {
        type: "string",
        title: "Embedding model id",
        description: "Hugging Face model id for Xenova feature-extraction (default: Xenova/all-MiniLM-L6-v2).",
        default: "Xenova/all-MiniLM-L6-v2",
      },
    },
    required: ["vaultRoot"],
  },
  tools: [
    {
      name: "obsidian_brain.read",
      displayName: "Read Obsidian brain note",
      description:
        "Read a Markdown note from your agent folder, or from common/ (prefix path with common/). Use at task start to reuse existing knowledge before rediscovering.",
      parametersSchema: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description:
              "Path relative to your agent brain folder, or common/foo.md to read shared notes.",
          },
        },
        required: ["relativePath"],
      },
    },
    {
      name: "obsidian_brain.write",
      displayName: "Write Obsidian brain note",
      description:
        "Create or overwrite a Markdown note in your agent folder. Save reusable artifacts, decisions, and important findings proactively. Use [[Note Title]] wikilinks to connect related notes.",
      parametersSchema: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "File path under your agent folder, e.g. api-auth-flow.md",
          },
          content: {
            type: "string",
            description: "Markdown content. Use [[Title]] to link related notes.",
          },
        },
        required: ["relativePath", "content"],
      },
    },
    {
      name: "obsidian_brain.append",
      displayName: "Append to Obsidian brain note",
      description:
        "Append text to an existing note in your agent folder. Prefer over write when adding incremental entries to logs or running notes.",
      parametersSchema: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "File path under your agent folder.",
          },
          content: {
            type: "string",
            description: "Text to append. Use [[Title]] to link related notes.",
          },
        },
        required: ["relativePath", "content"],
      },
    },
    {
      name: "obsidian_brain.list",
      displayName: "List Obsidian brain directory",
      description:
        "List files and subdirectories. Call at task start (scope: agent) to find notes matching the current topic, then check common/ for shared team knowledge.",
      parametersSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            description: "agent (default) or common",
            enum: ["agent", "common"],
          },
          subPath: {
            type: "string",
            description: "Optional subdirectory under the selected scope (use empty for root).",
          },
        },
        required: [],
      },
    },
    {
      name: "obsidian_brain.write_common",
      displayName: "Write shared common note",
      description:
        "Create or overwrite a note under company common/. Available to all agents when company-wide access is enabled, otherwise orchestrator agents only. Use for team digests, shared references, and cross-agent knowledge.",
      parametersSchema: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "Path under common/, e.g. weekly-digest.md",
          },
          content: {
            type: "string",
            description: "Markdown content. Use [[Title]] to link related notes.",
          },
        },
        required: ["relativePath", "content"],
      },
    },
    {
      name: "obsidian_brain.semantic_search",
      displayName: "Semantic search (RAG) over brain notes",
      description:
        "Rank Markdown chunks by embedding similarity instead of loading entire files. Prefer for large vaults.",
      parametersSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          scope: { type: "string", enum: ["agent", "common", "both"] },
          topK: { type: "number" },
          reindexFirst: { type: "boolean" },
        },
        required: ["query"],
      },
    },
    {
      name: "obsidian_brain.reindex_semantic",
      displayName: "Rebuild semantic search index",
      description: "Re-chunk and re-embed notes for obsidian_brain.semantic_search.",
      parametersSchema: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["agent", "common", "full"] },
        },
      },
    },
  ],
};

export default manifest;
