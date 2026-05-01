export type RetryPolicy = "none" | "conservative" | "standard" | "aggressive";
export type ReviewIntensity = "light" | "normal" | "strict";
export type CompactionIntensity = "minimal" | "balanced" | "aggressive";
export type DefaultOutputFormat = "markdown" | "plain_text" | "json" | "mixed";

export interface TeamSettings {
  teamName: string;
  /** 팀 목표 (한 줄 요약·OKR 등) */
  goal: string;
  parallelization: number;
  performanceProfile: "balanced" | "speed" | "quality";
  conventions: string;
  /** 팀 공유 프롬프트 (목표에 맞춘 지시·톤) */
  prompt: string;
  enabled?: boolean;
  /** 허용 도구 집합 — 줄바꿈 또는 쉼표로 구분된 식별자 */
  allowedTools: string;
  /** 승인 필요 여부 */
  approvalsRequired: boolean;
  /** 기본 산출물 형식 */
  defaultOutputFormat: DefaultOutputFormat;
  /** 참조 가능한 저장소/문서 범위 */
  referenceScope: string;
  /** 월 비용 상한 (센트, 0 = 미설정) */
  costMonthlyCapCents: number;
  retryPolicy: RetryPolicy;
  reviewIntensity: ReviewIntensity;
  compactionIntensity: CompactionIntensity;
}

const TEAM_METADATA_KEY = "paperclipTeam";

const RETRY: RetryPolicy[] = ["none", "conservative", "standard", "aggressive"];
const REVIEW: ReviewIntensity[] = ["light", "normal", "strict"];
const COMPACT: CompactionIntensity[] = ["minimal", "balanced", "aggressive"];
const FORMATS: DefaultOutputFormat[] = ["markdown", "plain_text", "json", "mixed"];

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asRetryPolicy(v: unknown): RetryPolicy {
  return typeof v === "string" && (RETRY as string[]).includes(v) ? (v as RetryPolicy) : "standard";
}

function asReviewIntensity(v: unknown): ReviewIntensity {
  return typeof v === "string" && (REVIEW as string[]).includes(v) ? (v as ReviewIntensity) : "normal";
}

function asCompactionIntensity(v: unknown): CompactionIntensity {
  return typeof v === "string" && (COMPACT as string[]).includes(v) ? (v as CompactionIntensity) : "balanced";
}

function asDefaultOutputFormat(v: unknown): DefaultOutputFormat {
  return typeof v === "string" && (FORMATS as string[]).includes(v) ? (v as DefaultOutputFormat) : "markdown";
}

function asNonNegativeInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function readTeamSettings(metadata: unknown): TeamSettings {
  const root = asObject(metadata);
  const raw = root ? asObject(root[TEAM_METADATA_KEY]) : null;
  const rawParallelization = typeof raw?.parallelization === "number" ? raw.parallelization : 1;
  const parallelization = Number.isFinite(rawParallelization)
    ? Math.min(12, Math.max(1, Math.round(rawParallelization)))
    : 1;
  const performanceProfile =
    raw?.performanceProfile === "speed" || raw?.performanceProfile === "quality"
      ? raw.performanceProfile
      : "balanced";
  return {
    teamName: typeof raw?.teamName === "string" ? raw.teamName : "",
    goal: typeof raw?.goal === "string" ? raw.goal : "",
    parallelization,
    performanceProfile,
    conventions: typeof raw?.conventions === "string" ? raw.conventions : "",
    prompt: typeof raw?.prompt === "string" ? raw.prompt : "",
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : undefined,
    allowedTools: typeof raw?.allowedTools === "string" ? raw.allowedTools : "",
    approvalsRequired: raw?.approvalsRequired === true,
    defaultOutputFormat: asDefaultOutputFormat(raw?.defaultOutputFormat),
    referenceScope: typeof raw?.referenceScope === "string" ? raw.referenceScope : "",
    costMonthlyCapCents: asNonNegativeInt(raw?.costMonthlyCapCents, 0),
    retryPolicy: asRetryPolicy(raw?.retryPolicy),
    reviewIntensity: asReviewIntensity(raw?.reviewIntensity),
    compactionIntensity: asCompactionIntensity(raw?.compactionIntensity),
  };
}

export function withTeamSettings(metadata: unknown, settings: TeamSettings): Record<string, unknown> {
  const root = asObject(metadata) ? { ...(metadata as Record<string, unknown>) } : {};
  const normalizedParallelization = Math.min(12, Math.max(1, Math.round(settings.parallelization)));
  root[TEAM_METADATA_KEY] = {
    teamName: settings.teamName,
    goal: settings.goal,
    parallelization: normalizedParallelization,
    performanceProfile: settings.performanceProfile,
    conventions: settings.conventions,
    prompt: settings.prompt,
    allowedTools: settings.allowedTools,
    approvalsRequired: settings.approvalsRequired,
    defaultOutputFormat: settings.defaultOutputFormat,
    referenceScope: settings.referenceScope,
    costMonthlyCapCents: Math.max(0, Math.floor(settings.costMonthlyCapCents)),
    retryPolicy: settings.retryPolicy,
    reviewIntensity: settings.reviewIntensity,
    compactionIntensity: settings.compactionIntensity,
    ...(typeof settings.enabled === "boolean" ? { enabled: settings.enabled } : {}),
  };
  return root;
}

export function hasTeamEnabled(metadata: unknown): boolean {
  return readTeamSettings(metadata).enabled === true;
}
