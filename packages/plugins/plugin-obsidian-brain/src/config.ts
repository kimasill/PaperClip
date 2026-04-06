export type ObsidianBrainConfig = {
  vaultRoot?: string;
  brainSubdir?: string;
  /** When true, any agent in the company may use write_common; orchestratorAgentIds is ignored for allowlisting. */
  allowAllAgentsCommonWrite?: boolean;
  orchestratorAgentIds?: string;
  enforceMdExtension?: boolean;
  maxReadBytes?: number;
  /** When false, semantic search / reindex tools are disabled. */
  semanticSearchEnabled?: boolean;
  /** Max characters per indexed chunk (paragraph merging/splitting). */
  maxChunkChars?: number;
  /** @xenova/transformers model id for feature-extraction. */
  embeddingModelId?: string;
};
