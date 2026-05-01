const PAPERCLIP_GITLAB_INTEGRATION_ENABLED_KEY = "paperclipGitlabIntegrationEnabled";
const GITLAB_DEFAULT_PROJECT_ID_KEY = "gitlabDefaultProjectId";

/** Merge into `adapterConfig` when creating or importing agents from UI wizard values. */
export function adapterConfigGitlabPatch(
  values: {
    paperclipGitlabIntegrationEnabled?: boolean;
    gitlabDefaultProjectId?: string;
  },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (values.paperclipGitlabIntegrationEnabled === true) {
    out[PAPERCLIP_GITLAB_INTEGRATION_ENABLED_KEY] = true;
  }
  const project = typeof values.gitlabDefaultProjectId === "string" ? values.gitlabDefaultProjectId.trim() : "";
  if (project) {
    out[GITLAB_DEFAULT_PROJECT_ID_KEY] = project;
  }
  return out;
}
