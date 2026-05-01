import type { JsonSchemaNode } from "@/components/JsonSchemaForm";

/**
 * Git Provider: ensure server issue auto-sync fields exist in the settings form even when
 * the installed plugin row has a stale `manifestJson` (missing newer schema properties).
 */
export function mergeGitProviderIssueSyncFieldsIntoSchema(schema: JsonSchemaNode): JsonSchemaNode {
  const properties = { ...(schema.properties ?? {}) };
  if (!properties.autoSyncIssues) {
    properties.autoSyncIssues = {
      type: "boolean",
      title: "Auto-sync Paperclip issues to GitLab",
      description:
        "When enabled, creating a Paperclip issue or changing its status automatically creates/updates a linked GitLab issue — no agent tokens consumed. Requires Default GitLab project for auto-sync to be set.",
      default: false,
    };
  }
  if (!properties.defaultGitlabProjectId) {
    properties.defaultGitlabProjectId = {
      type: "string",
      title: "Default GitLab project for auto-sync",
      description:
        "GitLab project id or URL-encoded path (e.g. group%2Fproject) used by auto-sync to create issues. Required when auto-sync is enabled.",
      default: "",
    };
  }
  return { ...schema, properties };
}
