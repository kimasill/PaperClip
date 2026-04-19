export interface TeamSettings {
  teamName: string;
  goal: string;
  parallelization: number;
  performanceProfile: "balanced" | "speed" | "quality";
  conventions: string;
  prompt: string;
  enabled?: boolean;
}

const TEAM_METADATA_KEY = "paperclipTeam";

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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
  };
}

export function withTeamSettings(metadata: unknown, settings: TeamSettings): Record<string, unknown> {
  const root = asObject(metadata) ? { ...(metadata as Record<string, unknown>) } : {};
  root[TEAM_METADATA_KEY] = {
    teamName: settings.teamName,
    goal: settings.goal,
    parallelization: settings.parallelization,
    performanceProfile: settings.performanceProfile,
    conventions: settings.conventions,
    prompt: settings.prompt,
    ...(typeof settings.enabled === "boolean" ? { enabled: settings.enabled } : {}),
  };
  return root;
}

export function hasTeamEnabled(metadata: unknown): boolean {
  return readTeamSettings(metadata).enabled === true;
}
