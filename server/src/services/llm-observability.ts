/**
 * Optional export of heartbeat / adapter execution metrics to LLM observability backends.
 * Currently: Langfuse (token usage, cost, latency, outcome). Phoenix/LangSmith: see `.env.example`.
 */
import { Langfuse } from "langfuse";
import type { AdapterExecutionResult, UsageSummary } from "../adapters/index.js";
import { logger } from "../middleware/logger.js";

function readNonEmptyEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = process.env[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

let langfuseClient: Langfuse | null | undefined;

function getLangfuseClient(): Langfuse | null {
  if (langfuseClient !== undefined) return langfuseClient;
  const secretKey = readNonEmptyEnv("LANGFUSE_SECRET_KEY", "PAPERCLIP_LANGFUSE_SECRET_KEY");
  const publicKey = readNonEmptyEnv("LANGFUSE_PUBLIC_KEY", "PAPERCLIP_LANGFUSE_PUBLIC_KEY");
  if (!secretKey || !publicKey) {
    langfuseClient = null;
    return null;
  }
  const baseUrl = readNonEmptyEnv("LANGFUSE_BASE_URL", "PAPERCLIP_LANGFUSE_BASE_URL");
  langfuseClient = new Langfuse({
    secretKey,
    publicKey,
    ...(baseUrl ? { baseUrl: baseUrl.replace(/\/+$/, "") } : {}),
  });
  return langfuseClient;
}

/** @internal */
export function resetLangfuseClientForTests(): void {
  langfuseClient = undefined;
}

export function isLangfuseObservabilityEnabled(): boolean {
  return getLangfuseClient() != null;
}

function normalizeUsage(u: UsageSummary | null | undefined): {
  input: number;
  output: number;
  cachedInput: number;
} {
  if (!u) return { input: 0, output: 0, cachedInput: 0 };
  return {
    input: Math.max(0, Math.floor(Number(u.inputTokens) || 0)),
    output: Math.max(0, Math.floor(Number(u.outputTokens) || 0)),
    cachedInput: Math.max(0, Math.floor(Number(u.cachedInputTokens) || 0)),
  };
}

export type HeartbeatLangfuseEmitInput = {
  runId: string;
  externalRunId?: string | null;
  companyId: string;
  agentId: string;
  agentName: string;
  adapterType: string | null;
  issueId: string | null;
  outcome: "succeeded" | "failed" | "cancelled" | "timed_out";
  startedAt: Date | null;
  finishedAt: Date;
  adapterResult: AdapterExecutionResult;
  normalizedUsage: UsageSummary | null;
  /** From `contextSnapshot.experimentKey` (profiling / A-B). */
  experimentKey?: string | null;
  /** From `agent.metadata.paperclipTeam` — for Langfuse filters & groupId. */
  teamName?: string | null;
  teamPerformanceProfile?: string | null;
  teamParallelization?: number | null;
};

const TEAM_META_KEY = "paperclipTeam";
const MAX_TAG_LEN = 64;

function truncateTag(s: string, max = MAX_TAG_LEN): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Derive experiment + team fields for Langfuse from a heartbeat run and agent row.
 */
export function extractHeartbeatLangfuseContext(
  contextSnapshot: Record<string, unknown> | null | undefined,
  agentMetadata: Record<string, unknown> | null | undefined,
): Pick<
  HeartbeatLangfuseEmitInput,
  "experimentKey" | "teamName" | "teamPerformanceProfile" | "teamParallelization"
> {
  const rawExp = contextSnapshot && typeof contextSnapshot.experimentKey === "string" ? contextSnapshot.experimentKey.trim() : "";
  const experimentKey = rawExp.length > 0 ? rawExp.slice(0, 160) : null;

  const rawTeam =
    agentMetadata && typeof agentMetadata[TEAM_META_KEY] === "object" && agentMetadata[TEAM_META_KEY] !== null
      ? (agentMetadata[TEAM_META_KEY] as Record<string, unknown>)
      : null;
  const teamName =
    rawTeam && typeof rawTeam.teamName === "string" && rawTeam.teamName.trim().length > 0
      ? rawTeam.teamName.trim().slice(0, 120)
      : null;
  const teamPerformanceProfile =
    rawTeam && (rawTeam.performanceProfile === "speed" || rawTeam.performanceProfile === "quality" || rawTeam.performanceProfile === "balanced")
      ? (rawTeam.performanceProfile as string)
      : null;
  const rawPar = rawTeam && typeof rawTeam.parallelization === "number" ? rawTeam.parallelization : null;
  const teamParallelization =
    rawPar != null && Number.isFinite(rawPar) ? Math.max(1, Math.round(rawPar)) : null;

  return { experimentKey, teamName, teamPerformanceProfile, teamParallelization };
}

/**
 * Sends one Langfuse trace per heartbeat run: trace-level metadata + a single GENERATION
 * observation with token/cost/latency. Never throws; logs at warn on failure.
 */
export async function emitHeartbeatRunToLangfuse(input: HeartbeatLangfuseEmitInput): Promise<void> {
  const lf = getLangfuseClient();
  if (!lf) return;

  const { input: inTok, output: outTok, cachedInput: cacheTok } = normalizeUsage(input.normalizedUsage);
  const latencyMs =
    input.startedAt != null
      ? Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime())
      : undefined;

  try {
    const exp = input.experimentKey?.trim() ?? "";
    const team = input.teamName?.trim() ?? "";
    const groupId =
      exp.length > 0 ? exp.slice(0, 200) : team.length > 0 ? `team:${team.slice(0, 180)}` : undefined;

    const extraTags: string[] = [];
    if (exp.length > 0) extraTags.push(`exp:${truncateTag(exp)}`);
    if (team.length > 0) extraTags.push(`team:${truncateTag(team)}`);
    if (input.teamPerformanceProfile) extraTags.push(`perf:${input.teamPerformanceProfile}`);

    const trace = lf.trace({
      id: input.externalRunId ?? input.runId,
      name: "paperclip-heartbeat",
      userId: input.agentId,
      ...(input.issueId ? { sessionId: input.issueId } : {}),
      ...(groupId ? { groupId } : {}),
      metadata: {
        paperclip: {
          heartbeatRunId: input.runId,
          companyId: input.companyId,
          agentName: input.agentName,
          adapterType: input.adapterType ?? "unknown",
          issueId: input.issueId,
          outcome: input.outcome,
          exitCode: input.adapterResult.exitCode,
          timedOut: input.adapterResult.timedOut,
          latencyMs,
          provider: input.adapterResult.provider ?? null,
          biller: input.adapterResult.biller ?? null,
          billingType: input.adapterResult.billingType ?? null,
          ...(exp.length > 0 ? { experimentKey: exp } : {}),
          ...(team.length > 0 ? { teamName: team } : {}),
          ...(input.teamPerformanceProfile ? { teamPerformanceProfile: input.teamPerformanceProfile } : {}),
          ...(input.teamParallelization != null ? { teamParallelization: input.teamParallelization } : {}),
        },
      },
      tags: [
        "paperclip",
        input.adapterType ?? "unknown-adapter",
        input.outcome,
        ...extraTags,
      ],
    });

    const model = input.adapterResult.model ?? "unknown";
    const costUsd = input.adapterResult.costUsd;

    const generation = trace.generation({
      name: "adapter-execution",
      model,
      startTime: input.startedAt ?? undefined,
      endTime: input.finishedAt,
      metadata: {
        exitCode: input.adapterResult.exitCode,
        errorCode: input.adapterResult.errorCode ?? null,
        runtimeServiceCount: input.adapterResult.runtimeServices?.length ?? 0,
        runtimeServices: (input.adapterResult.runtimeServices ?? []).map((s) => ({
          serviceName: s.serviceName,
          status: s.status ?? null,
          healthStatus: s.healthStatus ?? null,
          url: s.url ? "[redacted]" : null,
        })),
      },
      usage: {
        input: inTok,
        output: outTok,
        total: inTok + outTok,
      },
      usageDetails: {
        input: inTok,
        output: outTok,
        ...(cacheTok > 0 ? { cache_read_input_tokens: cacheTok } : {}),
      },
      ...(costUsd != null && Number.isFinite(costUsd)
        ? { costDetails: { total: costUsd } }
        : {}),
    });

    await lf.flushAsync();
  } catch (err) {
    logger.warn(
      { err, runId: input.runId, companyId: input.companyId },
      "langfuse observability export failed",
    );
  }
}
