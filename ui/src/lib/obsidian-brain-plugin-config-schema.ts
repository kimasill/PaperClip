import type { JsonSchemaNode } from "@/components/JsonSchemaForm";

/**
 * Obsidian Brain: ensure RAG / semantic search fields exist in the settings form even when
 * the installed plugin row has a stale `manifestJson` (missing newer schema properties).
 */
export function mergeObsidianBrainInstanceConfigSchema(schema: JsonSchemaNode): JsonSchemaNode {
  const properties = { ...(schema.properties ?? {}) };

  if (!properties.semanticSearchEnabled) {
    properties.semanticSearchEnabled = {
      type: "boolean",
      title: "Enable semantic search (RAG)",
      description:
        "When enabled, agents can call obsidian_brain.semantic_search and obsidian_brain.reindex_semantic. Uses local embeddings (@xenova/transformers) and a JSON index under PaperclipBrain/{companyId}/.semantic-index/.",
      default: true,
    };
  }
  if (!properties.maxChunkChars) {
    properties.maxChunkChars = {
      type: "number",
      title: "Max characters per indexed chunk",
      description: "Paragraphs are merged/split to stay under this size for embedding.",
      default: 720,
    };
  }
  if (!properties.embeddingModelId) {
    properties.embeddingModelId = {
      type: "string",
      title: "Embedding model id",
      description: "Hugging Face model id for Xenova feature-extraction (default: Xenova/all-MiniLM-L6-v2).",
      default: "Xenova/all-MiniLM-L6-v2",
    };
  }

  return { ...schema, properties };
}
