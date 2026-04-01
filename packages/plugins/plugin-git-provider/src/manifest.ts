import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclip.git-provider";
export const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Git Provider Tools",
  description: "Agent tools for creating GitHub pull requests and GitLab merge requests.",
  author: "Paperclip",
  categories: ["automation", "connector"],
  capabilities: [
    "agent.tools.register",
    "http.outbound",
    "secrets.read-ref",
    "activity.log.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      githubTokenRef: {
        type: "string",
        title: "GitHub token ref (optional)",
        description: "Secret ref for GitHub API authentication (fine-grained PAT or GitHub App installation token).",
        default: "",
      },
      gitlabTokenRef: {
        type: "string",
        title: "GitLab token ref (optional)",
        description: "Secret ref for GitLab API authentication (PAT with api/write_repository).",
        default: "",
      },
      defaultGithubApiBaseUrl: {
        type: "string",
        title: "GitHub API base URL",
        default: "https://api.github.com",
      },
      defaultGitlabApiBaseUrl: {
        type: "string",
        title: "GitLab API base URL",
        default: "https://gitlab.com/api/v4",
      },
    },
  },
  tools: [
    {
      name: "github.create_pull_request",
      displayName: "Create GitHub Pull Request",
      description: "Create a pull request on GitHub for an existing branch.",
      parametersSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          head: { type: "string", description: "Branch name or 'owner:branch'." },
          base: { type: "string", description: "Base branch name (e.g. main)." },
          draft: { type: "boolean", default: false },
        },
        required: ["owner", "repo", "title", "head", "base"],
      },
    },
    {
      name: "gitlab.create_merge_request",
      displayName: "Create GitLab Merge Request",
      description: "Create a merge request on GitLab for an existing branch.",
      parametersSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "GitLab project ID or URL-encoded path (e.g. group%2Fproj)." },
          title: { type: "string" },
          description: { type: "string" },
          sourceBranch: { type: "string" },
          targetBranch: { type: "string" },
          removeSourceBranch: { type: "boolean", default: false },
          draft: { type: "boolean", default: false },
        },
        required: ["projectId", "title", "sourceBranch", "targetBranch"],
      },
    },
  ],
};

export default manifest;

