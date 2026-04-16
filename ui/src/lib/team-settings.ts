export interface TeamSettings {
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
  return {
    conventions: typeof raw?.conventions === "string" ? raw.conventions : "",
    prompt: typeof raw?.prompt === "string" ? raw.prompt : "",
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : undefined,
  };
}

export function withTeamSettings(metadata: unknown, settings: TeamSettings): Record<string, unknown> {
  const root = asObject(metadata) ? { ...(metadata as Record<string, unknown>) } : {};
  root[TEAM_METADATA_KEY] = {
    conventions: settings.conventions,
    prompt: settings.prompt,
    ...(typeof settings.enabled === "boolean" ? { enabled: settings.enabled } : {}),
  };
  return root;
}

export function hasTeamEnabled(metadata: unknown): boolean {
  return readTeamSettings(metadata).enabled === true;
}
