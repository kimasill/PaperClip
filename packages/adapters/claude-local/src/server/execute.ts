import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOCAL_ADAPTER_PROMPT_TEMPLATE,
  heartbeatIssueDigestFromContext,
  paperclipGitlabIntegrationPromptFromContext,
  paperclipObsidianBrainWorkflowPromptFromContext,
  type AdapterExecutionContext,
  type AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import type { RunProcessResult } from "@paperclipai/adapter-utils/server-utils";
import {
  asString,
  asNumber,
  asBoolean,
  asStringArray,
  parseObject,
  parseJson,
  buildPaperclipEnv,
  readPaperclipRuntimeSkillEntries,
  joinPromptSections,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  linkPaperclipSkillDir,
  resolveCommandForLogs,
  renderTemplate,
  runChildProcess,
  toPosixPathForBash,
  writePaperclipRuntimeEnvShFile,
} from "@paperclipai/adapter-utils/server-utils";
import {
  parseClaudeStreamJson,
  describeClaudeFailure,
  detectClaudeLoginRequired,
  isClaudeMaxTurnsResult,
  isClaudeUnknownSessionError,
  isClaudeUnknownSessionErrorFromStderr,
} from "./parse.js";
import { resolveClaudeDesiredSkillNames } from "./skills.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Pre-created Node.js helper placed in the skills tmpdir so Claude agents can
 * call the Paperclip API without needing write permissions at runtime.
 * Usage (from workspace cwd):
 *   source .paperclip/runtime-env.sh && node "$PAPERCLIP_PC_JS_PATH" /api/agents/me
 */
const PC_JS_CONTENT = `\
const http = require('http');
const apiUrl = process.env.PAPERCLIP_API_URL;
const apiKey = process.env.PAPERCLIP_API_KEY;
const runId = process.env.PAPERCLIP_RUN_ID;
const agentId = process.env.PAPERCLIP_AGENT_ID;
const companyId = process.env.PAPERCLIP_COMPANY_ID;
const taskId = process.env.PAPERCLIP_TASK_ID;
const wakeReason = process.env.PAPERCLIP_WAKE_REASON;
const wakeComment = process.env.PAPERCLIP_WAKE_COMMENT_ID;

console.log('ENV:', JSON.stringify({apiUrl, agentId, companyId, runId, taskId, wakeReason, wakeComment, hasKey: !!apiKey}));

const endpoint = process.argv[2] || '/api/agents/me';
const url = new URL(apiUrl + endpoint);
const proto = url.protocol === 'https:' ? require('https') : http;
const opts = {
  hostname: url.hostname,
  port: url.port || (url.protocol === 'https:' ? 443 : 80),
  path: url.pathname + url.search,
  headers: {
    'Authorization': 'Bearer ' + apiKey,
    'X-Paperclip-Run-Id': runId || '',
  },
};
proto.get(opts, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log(d));
}).on('error', e => console.error('Error:', e.message));
`;

/**
 * Build a Claude Code settings.json that grants maximal permissions for
 * unattended Paperclip runs. Written into the skillsDir so `--settings`
 * can reference it.  When `dangerouslySkipPermissions` is false, a softer
 * `acceptEdits` mode with generous allow-rules is used instead.
 */
function buildClaudeSettingsJson(opts: {
  dangerouslySkipPermissions: boolean;
  allowedTools: string[];
  deniedTools: string[];
}): string {
  const { dangerouslySkipPermissions, allowedTools, deniedTools } = opts;
  const defaultMode = dangerouslySkipPermissions ? "bypassPermissions" : "acceptEdits";
  const allow =
    allowedTools.length > 0
      ? allowedTools
      : [
          "Read",
          "Write",
          "Edit",
          "MultiEdit",
          "Bash(*)",
          "WebSearch",
          "WebFetch",
          "Agent",
          "mcp__*",
        ];
  const settings: Record<string, unknown> = {
    permissions: {
      defaultMode,
      allow,
      ...(deniedTools.length > 0 ? { deny: deniedTools } : {}),
    },
  };
  return JSON.stringify(settings, null, 2);
}

/**
 * Create a tmpdir with `.claude/skills/` containing symlinks to skills from
 * the repo's `skills/` directory, so `--add-dir` makes Claude Code discover
 * them as proper registered skills.
 *
 * Also pre-creates `pc.js` at the root of the tmpdir so agents can call the
 * Paperclip API without needing write permissions.
 *
 * Writes a `settings.json` with maximal runtime permissions so headless runs
 * are not blocked by interactive approval prompts.
 */
async function buildSkillsDir(config: Record<string, unknown>): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-skills-"));
  const target = path.join(tmp, ".claude", "skills");
  await fs.mkdir(target, { recursive: true });
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredNames = new Set(
    resolveClaudeDesiredSkillNames(
      config,
      availableEntries,
    ),
  );
  for (const entry of availableEntries) {
    if (!desiredNames.has(entry.key)) continue;
    await linkPaperclipSkillDir(entry.source, path.join(target, entry.runtimeName));
  }
  await fs.writeFile(path.join(tmp, "pc.js"), PC_JS_CONTENT, "utf-8");

  const dangerouslySkipPermissions = asBoolean(config.dangerouslySkipPermissions, true);
  const allowedTools = asStringArray(config.allowedTools);
  const deniedTools = asStringArray(config.deniedTools);
  const settingsJson = buildClaudeSettingsJson({
    dangerouslySkipPermissions,
    allowedTools,
    deniedTools,
  });
  await fs.writeFile(path.join(tmp, "paperclip-settings.json"), settingsJson, "utf-8");
  return tmp;
}

interface ClaudeExecutionInput {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  authToken?: string;
}

interface ClaudeRuntimeConfig {
  command: string;
  resolvedCommand: string;
  cwd: string;
  workspaceId: string | null;
  workspaceRepoUrl: string | null;
  workspaceRepoRef: string | null;
  env: Record<string, string>;
  loggedEnv: Record<string, string>;
  timeoutSec: number;
  graceSec: number;
  extraArgs: string[];
}

function buildLoginResult(input: {
  proc: RunProcessResult;
  loginUrl: string | null;
}) {
  return {
    exitCode: input.proc.exitCode,
    signal: input.proc.signal,
    timedOut: input.proc.timedOut,
    stdout: input.proc.stdout,
    stderr: input.proc.stderr,
    loginUrl: input.loginUrl,
  };
}

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function resolveClaudeBillingType(env: Record<string, string>): "api" | "subscription" {
  // Claude uses API-key auth when ANTHROPIC_API_KEY is present; otherwise rely on local login/session auth.
  return hasNonEmptyEnvValue(env, "ANTHROPIC_API_KEY") ? "api" : "subscription";
}

/** Align with server `resolveLegacyInstructionsPath` and pi/opencode-local: relative paths resolve against absolute `config.cwd` when set, else the runtime workspace cwd. */
function resolveLocalAdapterInstructionsFilePath(
  raw: string,
  configuredAdapterCwd: string,
  runtimeCwd: string,
): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (path.isAbsolute(trimmed)) return trimmed;
  const adapterCwd = configuredAdapterCwd.trim();
  if (adapterCwd && path.isAbsolute(adapterCwd)) {
    return path.resolve(adapterCwd, trimmed);
  }
  return path.resolve(runtimeCwd, trimmed);
}

async function buildClaudeRuntimeConfig(input: ClaudeExecutionInput): Promise<ClaudeRuntimeConfig> {
  const { runId, agent, config, context, authToken } = input;

  const command = asString(config.command, "claude");
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceStrategy = asString(workspaceContext.strategy, "");
  const workspaceId = asString(workspaceContext.workspaceId, "") || null;
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "") || null;
  const workspaceRepoRef = asString(workspaceContext.repoRef, "") || null;
  const workspaceBranch = asString(workspaceContext.branchName, "") || null;
  const workspaceWorktreePath = asString(workspaceContext.worktreePath, "") || null;
  const agentHome = asString(workspaceContext.agentHome, "") || null;
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimeServiceIntents = Array.isArray(context.paperclipRuntimeServiceIntents)
    ? context.paperclipRuntimeServiceIntents.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimeServices = Array.isArray(context.paperclipRuntimeServices)
    ? context.paperclipRuntimeServices.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimePrimaryUrl = asString(context.paperclipRuntimePrimaryUrl, "");
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.PAPERCLIP_API_KEY === "string" && envConfig.PAPERCLIP_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (wakeTaskId) {
    env.PAPERCLIP_TASK_ID = wakeTaskId;
  }
  if (wakeReason) {
    env.PAPERCLIP_WAKE_REASON = wakeReason;
  }
  if (wakeCommentId) {
    env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  }
  if (approvalId) {
    env.PAPERCLIP_APPROVAL_ID = approvalId;
  }
  if (approvalStatus) {
    env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  }
  if (linkedIssueIds.length > 0) {
    env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  }
  if (effectiveWorkspaceCwd) {
    env.PAPERCLIP_WORKSPACE_CWD = effectiveWorkspaceCwd;
  }
  if (workspaceSource) {
    env.PAPERCLIP_WORKSPACE_SOURCE = workspaceSource;
  }
  if (workspaceStrategy) {
    env.PAPERCLIP_WORKSPACE_STRATEGY = workspaceStrategy;
  }
  if (workspaceId) {
    env.PAPERCLIP_WORKSPACE_ID = workspaceId;
  }
  if (workspaceRepoUrl) {
    env.PAPERCLIP_WORKSPACE_REPO_URL = workspaceRepoUrl;
  }
  if (workspaceRepoRef) {
    env.PAPERCLIP_WORKSPACE_REPO_REF = workspaceRepoRef;
  }
  if (workspaceBranch) {
    env.PAPERCLIP_WORKSPACE_BRANCH = workspaceBranch;
  }
  if (workspaceWorktreePath) {
    env.PAPERCLIP_WORKSPACE_WORKTREE_PATH = workspaceWorktreePath;
  }
  if (agentHome) {
    env.AGENT_HOME = agentHome;
  }
  if (workspaceHints.length > 0) {
    env.PAPERCLIP_WORKSPACES_JSON = JSON.stringify(workspaceHints);
  }
  if (runtimeServiceIntents.length > 0) {
    env.PAPERCLIP_RUNTIME_SERVICE_INTENTS_JSON = JSON.stringify(runtimeServiceIntents);
  }
  if (runtimeServices.length > 0) {
    env.PAPERCLIP_RUNTIME_SERVICES_JSON = JSON.stringify(runtimeServices);
  }
  if (runtimePrimaryUrl) {
    env.PAPERCLIP_RUNTIME_PRIMARY_URL = runtimePrimaryUrl;
  }

  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  if (!hasExplicitApiKey && authToken?.trim()) {
    env.PAPERCLIP_API_KEY = authToken.trim();
  }

  const runtimeEnvShPath = await writePaperclipRuntimeEnvShFile(cwd, env);
  if (runtimeEnvShPath) {
    env.PAPERCLIP_ENV_SH_PATH = runtimeEnvShPath;
  }

  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  await ensureCommandResolvable(command, cwd, runtimeEnv);
  const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME", "CLAUDE_CONFIG_DIR"],
    resolvedCommand,
  });

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 20);
  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();

  return {
    command,
    resolvedCommand,
    cwd,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    env,
    loggedEnv,
    timeoutSec,
    graceSec,
    extraArgs,
  };
}

export async function runClaudeLogin(input: {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  context?: Record<string, unknown>;
  authToken?: string;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}) {
  const onLog = input.onLog ?? (async () => {});
  const runtime = await buildClaudeRuntimeConfig({
    runId: input.runId,
    agent: input.agent,
    config: input.config,
    context: input.context ?? {},
    authToken: input.authToken,
  });

  const proc = await runChildProcess(input.runId, runtime.command, ["login"], {
    cwd: runtime.cwd,
    env: runtime.env,
    timeoutSec: runtime.timeoutSec,
    graceSec: runtime.graceSec,
    onLog,
  });

  const loginMeta = detectClaudeLoginRequired({
    parsed: null,
    stdout: proc.stdout,
    stderr: proc.stderr,
  });

  return buildLoginResult({
    proc,
    loginUrl: loginMeta.loginUrl,
  });
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;

  const promptTemplate = asString(
    config.promptTemplate,
    DEFAULT_LOCAL_ADAPTER_PROMPT_TEMPLATE,
  );
  const model = asString(config.model, "");
  const effort = asString(config.effort, "");
  const chrome = asBoolean(config.chrome, false);
  const maxTurns = asNumber(config.maxTurnsPerRun, 0);
  const dangerouslySkipPermissions = asBoolean(config.dangerouslySkipPermissions, true);
  const claudeEnableAutoMode = asBoolean(config.claudeEnableAutoMode, true);
  const instructionsFilePathRaw = asString(config.instructionsFilePath, "").trim();

  const runtimeConfig = await buildClaudeRuntimeConfig({
    runId,
    agent,
    config,
    context,
    authToken,
  });
  const {
    command,
    resolvedCommand,
    cwd,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    env,
    loggedEnv,
    timeoutSec,
    graceSec,
    extraArgs,
  } = runtimeConfig;
  const effectiveEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const billingType = resolveClaudeBillingType(effectiveEnv);
  const skillsDir = await buildSkillsDir(config);
  const pcJsPath = toPosixPathForBash(path.resolve(path.join(skillsDir, "pc.js")));

  const configuredAdapterCwd = asString(config.cwd, "").trim();
  const workspaceForInstructions = parseObject(context.paperclipWorkspace);
  const agentHomeForInstructions = asString(workspaceForInstructions.agentHome, "").trim();
  const managedInstructionsFallback = agentHomeForInstructions
    ? path.join(agentHomeForInstructions, "instructions", "AGENTS.md")
    : "";
  const managedInstructionsDir = agentHomeForInstructions
    ? path.join(agentHomeForInstructions, "instructions")
    : "";
  const managedInstructionsDirReady =
    managedInstructionsDir.length > 0 &&
    (await fs.stat(managedInstructionsDir).then(
      (st) => st.isDirectory(),
      () => false,
    ));

  let commandNotes: string[] = [];
  let effectiveInstructionsFilePath: string | undefined;

  // When instructionsFilePath is configured, create a combined temp file that
  // includes both the file content and the path directive, so we only need
  // --append-system-prompt-file (Claude CLI forbids using both flags together).
  if (instructionsFilePathRaw) {
    const primaryResolved = resolveLocalAdapterInstructionsFilePath(
      instructionsFilePathRaw,
      configuredAdapterCwd,
      cwd,
    );
    let usedPath = primaryResolved;
    let instructionsContent: string | undefined;
    let firstErr: unknown;
    try {
      instructionsContent = await fs.readFile(primaryResolved, "utf-8");
    } catch (err) {
      firstErr = err;
      if (
        managedInstructionsFallback &&
        path.resolve(managedInstructionsFallback) !== path.resolve(primaryResolved)
      ) {
        try {
          instructionsContent = await fs.readFile(managedInstructionsFallback, "utf-8");
          usedPath = managedInstructionsFallback;
        } catch {
          instructionsContent = undefined;
        }
      }
    }

    if (instructionsContent !== undefined) {
      const instructionsFileDir = `${path.dirname(usedPath)}/`;
      const pathDirective = `\nThe above agent instructions were loaded from ${usedPath}. Resolve any relative file references from ${instructionsFileDir}.`;
      const combinedPath = path.join(skillsDir, "agent-instructions.md");
      await fs.writeFile(combinedPath, instructionsContent + pathDirective, "utf-8");
      effectiveInstructionsFilePath = combinedPath;
      commandNotes = [
        `Injected agent instructions via --append-system-prompt-file ${usedPath} (with path directive appended)`,
      ];
    } else {
      const reason = firstErr instanceof Error ? firstErr.message : String(firstErr);
      const extra =
        managedInstructionsFallback && path.resolve(managedInstructionsFallback) !== path.resolve(primaryResolved)
          ? ` (also tried ${managedInstructionsFallback})`
          : "";
      await onLog(
        "stderr",
        `[paperclip] Warning: could not read agent instructions file "${primaryResolved}"${extra}: ${reason}\n`,
      );
    }
  }

  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const canResumeSession =
    runtimeSessionId.length > 0 &&
    (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(cwd));
  const sessionId = canResumeSession ? runtimeSessionId : null;
  if (runtimeSessionId && !canResumeSession) {
    await onLog(
      "stdout",
      `[paperclip] Claude session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${cwd}".\n`,
    );
  }
  const bootstrapPromptTemplate = asString(config.bootstrapPromptTemplate, "");
  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);
  const renderedBootstrapPrompt =
    !sessionId && bootstrapPromptTemplate.trim().length > 0
      ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
      : "";
  const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
  const runJwtUnavailableNote = (() => {
    const c = context as Record<string, unknown>;
    const flag = c.paperclipRunJwtUnavailable;
    if (flag !== true && flag !== "true") return "";
    const reason =
      typeof c.paperclipRunJwtUnavailableReason === "string" ? c.paperclipRunJwtUnavailableReason.trim() : "";
    return [
      "## Paperclip run JWT",
      reason ||
        "No run JWT was injected. If the Paperclip API server lacks `PAPERCLIP_AGENT_JWT_SECRET`, set it and restart.",
      "Do **not** conclude you are outside a Paperclip heartbeat only because `PAPERCLIP_API_KEY` is missing; missing optional wake vars are a separate case.",
    ].join("\n");
  })();
  const bashSandboxEnvHint = env.PAPERCLIP_ENV_SH_PATH
    ? [
        "## Bash / Claude Code sandbox",
        "The Bash tool may not inherit `PAPERCLIP_*`. From **this run's workspace cwd**, run:",
        "`source .paperclip/runtime-env.sh`",
        "Then call the API (example): `curl -fsS -H \"Authorization: Bearer $PAPERCLIP_API_KEY\" \"$PAPERCLIP_API_URL/api/agents/me\"`",
        "Do **not** use Read on `runtime-env.sh` to decide whether the JWT exists — tools often redact secrets. If `source` works, `$PAPERCLIP_API_KEY` is set.",
        `Optional absolute path (POSIX): \`${env.PAPERCLIP_ENV_SH_PATH}\``,
        "",
        "A Node.js API helper is pre-created at (no write permission needed):",
        `\`${pcJsPath}\``,
        "Usage: `source .paperclip/runtime-env.sh && node \"" + pcJsPath + "\" /api/agents/me`",
        "Do **not** write your own pc.js — use the pre-created one above.",
      ].join("\n")
    : "";
  const heartbeatIssueDigest = heartbeatIssueDigestFromContext(context as Record<string, unknown>);
  const obsidianBrainWorkflow = paperclipObsidianBrainWorkflowPromptFromContext(context as Record<string, unknown>);
  const gitlabIntegration = paperclipGitlabIntegrationPromptFromContext(context as Record<string, unknown>);
  const prompt = joinPromptSections([
    heartbeatIssueDigest,
    renderedBootstrapPrompt,
    runJwtUnavailableNote,
    sessionHandoffNote,
    bashSandboxEnvHint,
    obsidianBrainWorkflow,
    gitlabIntegration,
    renderedPrompt,
  ]);
  const promptMetrics = {
    promptChars: prompt.length,
    bootstrapPromptChars: renderedBootstrapPrompt.length,
    sessionHandoffChars: sessionHandoffNote.length,
    heartbeatPromptChars: renderedPrompt.length,
  };

  const hasClaudeAutoModeArg = (argsList: readonly string[]) =>
    argsList.some((a) => a === "--enable-auto-mode" || a.startsWith("--enable-auto-mode="));

  const settingsFilePath = path.join(skillsDir, "paperclip-settings.json");

  const buildClaudeArgs = (resumeSessionId: string | null) => {
    const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];
    args.push("--settings", settingsFilePath);
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    if (dangerouslySkipPermissions) {
      args.push("--permission-mode", "bypassPermissions");
    }
    if (chrome) args.push("--chrome");
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    if (maxTurns > 0) args.push("--max-turns", String(maxTurns));
    if (effectiveInstructionsFilePath) {
      args.push("--append-system-prompt-file", effectiveInstructionsFilePath);
    }
    args.push("--add-dir", skillsDir);
    if (managedInstructionsDirReady) {
      args.push("--add-dir", managedInstructionsDir);
    }
    if (claudeEnableAutoMode && !hasClaudeAutoModeArg(extraArgs)) {
      args.push("--enable-auto-mode");
    }
    if (extraArgs.length > 0) args.push(...extraArgs);
    return args;
  };

  const parseFallbackErrorMessage = (proc: RunProcessResult) => {
    const stderrLine =
      proc.stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? "";

    if ((proc.exitCode ?? 0) === 0) {
      return "Failed to parse claude JSON output";
    }

    return stderrLine
      ? `Claude exited with code ${proc.exitCode ?? -1}: ${stderrLine}`
      : `Claude exited with code ${proc.exitCode ?? -1}`;
  };

  const runAttempt = async (resumeSessionId: string | null) => {
    const args = buildClaudeArgs(resumeSessionId);
    if (onMeta) {
      await onMeta({
        adapterType: "claude_local",
        command: resolvedCommand,
        cwd,
        commandArgs: args,
        commandNotes,
        env: loggedEnv,
        prompt,
        promptMetrics,
        context,
      });
    }

    const proc = await runChildProcess(runId, command, args, {
      cwd,
      env,
      stdin: prompt,
      timeoutSec,
      graceSec,
      onSpawn,
      onLog,
    });

    const parsedStream = parseClaudeStreamJson(proc.stdout);
    const parsed = parsedStream.resultJson ?? parseJson(proc.stdout);
    return { proc, parsedStream, parsed };
  };

  const toAdapterResult = (
    attempt: {
      proc: RunProcessResult;
      parsedStream: ReturnType<typeof parseClaudeStreamJson>;
      parsed: Record<string, unknown> | null;
    },
    opts: { fallbackSessionId: string | null; clearSessionOnMissingSession?: boolean },
  ): AdapterExecutionResult => {
    const { proc, parsedStream, parsed } = attempt;
    const loginMeta = detectClaudeLoginRequired({
      parsed,
      stdout: proc.stdout,
      stderr: proc.stderr,
    });
    const errorMeta =
      loginMeta.loginUrl != null
        ? {
            loginUrl: loginMeta.loginUrl,
          }
        : undefined;

    if (proc.timedOut) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        errorCode: "timeout",
        errorMeta,
        clearSession: Boolean(opts.clearSessionOnMissingSession),
      };
    }

    if (!parsed) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: false,
        errorMessage: parseFallbackErrorMessage(proc),
        errorCode: loginMeta.requiresLogin ? "claude_auth_required" : null,
        errorMeta,
        resultJson: {
          stdout: proc.stdout,
          stderr: proc.stderr,
        },
        clearSession: Boolean(opts.clearSessionOnMissingSession),
      };
    }

    const usage =
      parsedStream.usage ??
      (() => {
        const usageObj = parseObject(parsed.usage);
        return {
          inputTokens: asNumber(usageObj.input_tokens, 0),
          cachedInputTokens: asNumber(usageObj.cache_read_input_tokens, 0),
          outputTokens: asNumber(usageObj.output_tokens, 0),
        };
      })();

    const resolvedSessionId =
      parsedStream.sessionId ??
      (asString(parsed.session_id, opts.fallbackSessionId ?? "") || opts.fallbackSessionId);
    const resolvedSessionParams = resolvedSessionId
      ? ({
        sessionId: resolvedSessionId,
        cwd,
        ...(workspaceId ? { workspaceId } : {}),
        ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
        ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
      } as Record<string, unknown>)
      : null;
    const clearSessionForMaxTurns = isClaudeMaxTurnsResult(parsed);

    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage:
        (proc.exitCode ?? 0) === 0
          ? null
          : describeClaudeFailure(parsed) ?? `Claude exited with code ${proc.exitCode ?? -1}`,
      errorCode: loginMeta.requiresLogin ? "claude_auth_required" : null,
      errorMeta,
      usage,
      sessionId: resolvedSessionId,
      sessionParams: resolvedSessionParams,
      sessionDisplayId: resolvedSessionId,
      provider: "anthropic",
      biller: "anthropic",
      model: parsedStream.model || asString(parsed.model, model),
      billingType,
      costUsd: parsedStream.costUsd ?? asNumber(parsed.total_cost_usd, 0),
      resultJson: parsed,
      summary: parsedStream.summary || asString(parsed.result, ""),
      clearSession: clearSessionForMaxTurns || Boolean(opts.clearSessionOnMissingSession && !resolvedSessionId),
    };
  };

  try {
    const initial = await runAttempt(sessionId ?? null);
    const isSessionError =
      initial.parsed && isClaudeUnknownSessionError(initial.parsed)
        ? true
        : isClaudeUnknownSessionErrorFromStderr(initial.proc.stderr);
    if (
      sessionId &&
      !initial.proc.timedOut &&
      (initial.proc.exitCode ?? 0) !== 0 &&
      isSessionError
    ) {
      await onLog(
        "stdout",
        `[paperclip] Claude resume session "${sessionId}" is unavailable; retrying with a fresh session.\n`,
      );
      const retry = await runAttempt(null);
      return toAdapterResult(retry, { fallbackSessionId: null, clearSessionOnMissingSession: true });
    }

    return toAdapterResult(initial, { fallbackSessionId: runtimeSessionId || runtime.sessionId });
  } finally {
    fs.rm(skillsDir, { recursive: true, force: true }).catch(() => {});
  }
}
