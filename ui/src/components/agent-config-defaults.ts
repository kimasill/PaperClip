import type { CreateConfigValues } from "@paperclipai/adapter-utils";

export const defaultCreateValues: CreateConfigValues = {
  adapterType: "claude_local",
  cwd: "",
  instructionsFilePath: "",
  promptTemplate: "",
  model: "",
  thinkingEffort: "",
  chrome: false,
  dangerouslySkipPermissions: true,
  search: false,
  dangerouslyBypassSandbox: false,
  command: "",
  args: "",
  // Adapter-specific. (e.g. Claude Code CLI may use --enable-auto-mode.)
  // Do not set a global default because many local CLIs reject unknown flags.
  extraArgs: "",
  envVars: "",
  envBindings: {},
  url: "",
  bootstrapPrompt: "",
  payloadTemplateJson: "",
  workspaceStrategyType: "project_primary",
  workspaceBaseRef: "",
  workspaceBranchTemplate: "",
  worktreeParentDir: "",
  runtimeServicesJson: "",
  maxTurnsPerRun: 300,
  heartbeatEnabled: false,
  intervalSec: 300,
};
