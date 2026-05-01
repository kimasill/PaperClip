/**
 * Browser-safe helpers for reading and writing the per-agent
 * `adapterConfig.paperclipSkillSync` block. Kept in its own module so the UI
 * can import these without pulling `node:fs` / `node:child_process` from
 * `server-utils.ts`.
 */

export interface PaperclipSkillSyncPreference {
  explicit: boolean;
  desiredSkills: string[];
}

/**
 * Bundled skills under `skills/paperclip-skill-installer` and
 * `skills/paperclip-agent-skill-manager` (canonical keys
 * `paperclipai/paperclip/...`). When {@link PaperclipSkillRuntimePolicy.autoMaterializeRuntimeSkills}
 * is false, these are withheld from adapter runtime injection and from effective
 * desired-skill resolution so arbitrary agents cannot use install/sync playbooks.
 */
const PAPERCLIP_GOVERNANCE_SKILL_CANONICAL_KEYS = new Set([
  "paperclipai/paperclip/paperclip-skill-installer",
  "paperclipai/paperclip/paperclip-agent-skill-manager",
]);

export function isPaperclipGovernanceSkillKey(skillKey: string): boolean {
  if (PAPERCLIP_GOVERNANCE_SKILL_CANONICAL_KEYS.has(skillKey)) return true;
  const k = skillKey.trim().toLowerCase();
  return k.endsWith("/paperclip-skill-installer") || k.endsWith("/paperclip-agent-skill-manager");
}

/**
 * When {@link PaperclipSkillRuntimePolicy.autoMaterializeRuntimeSkills} is false,
 * removes governance installer/manager keys. Default policy (true) keeps all keys.
 */
export function filterGovernanceSkillKeysForRuntimePolicy(
  keys: string[],
  adapterConfig: Record<string, unknown>,
): string[] {
  if (readPaperclipSkillRuntimePolicy(adapterConfig).autoMaterializeRuntimeSkills !== false) {
    return keys;
  }
  return keys.filter((key) => !isPaperclipGovernanceSkillKey(key));
}

/**
 * Merges persisted `agent.adapterConfig.paperclipSkillSync` onto the resolved
 * runtime adapter config so policy flags (e.g. `autoMaterializeRuntimeSkills`)
 * are read from the agent record, not only from secret-resolved env slices.
 */
export function mergeRuntimeConfigWithAgentSkillPolicy(
  runtimeConfig: Record<string, unknown>,
  agentAdapterConfig: unknown,
): Record<string, unknown> {
  if (typeof agentAdapterConfig !== "object" || agentAdapterConfig === null || Array.isArray(agentAdapterConfig)) {
    return runtimeConfig;
  }
  const ac = agentAdapterConfig as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(ac, "paperclipSkillSync")) return runtimeConfig;
  return {
    ...runtimeConfig,
    paperclipSkillSync: ac.paperclipSkillSync,
  };
}

/**
 * Shallow copy of adapter config with governance skill references stripped from
 * `paperclipSkillSync.desiredSkills` when runtime policy disables them. Does not
 * mutate the input.
 */
export function stripGovernanceSkillsFromAdapterConfigForRuntime(
  adapterConfig: Record<string, unknown>,
): Record<string, unknown> {
  if (readPaperclipSkillRuntimePolicy(adapterConfig).autoMaterializeRuntimeSkills !== false) {
    return adapterConfig;
  }
  const pref = readPaperclipSkillSyncPreference(adapterConfig);
  const nextDesired = filterGovernanceSkillKeysForRuntimePolicy(pref.desiredSkills, adapterConfig);
  if (nextDesired.length === pref.desiredSkills.length) return adapterConfig;
  const raw = adapterConfig.paperclipSkillSync;
  const sync =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  return { ...adapterConfig, paperclipSkillSync: { ...sync, desiredSkills: nextDesired } };
}

export interface PaperclipSkillRuntimePolicy {
  /**
   * When false, Paperclip never auto-materializes company skills into the
   * managed runtime directory for this agent. When true (default), adapter-type
   * defaults apply (Claude local skips materialization; other locals materialize).
   *
   * Also gates exposure of bundled governance skills (`paperclip-skill-installer`,
   * `paperclip-agent-skill-manager`): when false, they are omitted from runtime
   * skill lists and effective desired-skill sets for this agent.
   */
  autoMaterializeRuntimeSkills: boolean;
  /**
   * When true, this agent may call `POST /api/agents/:id/skills/sync` for
   * another agent in the same company only if that agent's `reportsTo` is this
   * agent's id, without CEO / chain-of-command / agents:create permission.
   */
  allowDelegatedSkillSyncToDirectReports: boolean;
}

function asSyncRecord(config: Record<string, unknown>): Record<string, unknown> | null {
  const raw = config.paperclipSkillSync;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

export function readPaperclipSkillSyncPreference(
  config: Record<string, unknown>,
): PaperclipSkillSyncPreference {
  const syncConfig = asSyncRecord(config);
  if (!syncConfig) return { explicit: false, desiredSkills: [] };
  const desiredValues = syncConfig.desiredSkills;
  const desired = Array.isArray(desiredValues)
    ? desiredValues
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  return {
    explicit: Object.prototype.hasOwnProperty.call(syncConfig, "desiredSkills"),
    desiredSkills: Array.from(new Set(desired)),
  };
}

export function readPaperclipSkillRuntimePolicy(
  config: Record<string, unknown>,
): PaperclipSkillRuntimePolicy {
  const syncConfig = asSyncRecord(config);
  if (!syncConfig) {
    return { autoMaterializeRuntimeSkills: true, allowDelegatedSkillSyncToDirectReports: false };
  }
  return {
    autoMaterializeRuntimeSkills: syncConfig.autoMaterializeRuntimeSkills !== false,
    allowDelegatedSkillSyncToDirectReports: syncConfig.allowDelegatedSkillSyncToDirectReports === true,
  };
}

export function resolveRuntimeSkillMaterializeMissing(
  adapterType: string,
  adapterConfig: Record<string, unknown>,
): boolean {
  const { autoMaterializeRuntimeSkills } = readPaperclipSkillRuntimePolicy(adapterConfig);
  if (!autoMaterializeRuntimeSkills) return false;
  return adapterType !== "claude_local";
}

export function writePaperclipSkillSyncPreference(
  config: Record<string, unknown>,
  desiredSkills: string[],
): Record<string, unknown> {
  const next = { ...config };
  const current = asSyncRecord(next) ? { ...(next.paperclipSkillSync as Record<string, unknown>) } : {};
  current.desiredSkills = Array.from(
    new Set(
      desiredSkills
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  next.paperclipSkillSync = current;
  return next;
}

export function mergePaperclipSkillRuntimePolicy(
  config: Record<string, unknown>,
  patch: Partial<Pick<
    PaperclipSkillRuntimePolicy,
    "autoMaterializeRuntimeSkills" | "allowDelegatedSkillSyncToDirectReports"
  >>,
): Record<string, unknown> {
  const next = { ...config };
  const current = asSyncRecord(next) ? { ...(next.paperclipSkillSync as Record<string, unknown>) } : {};
  if (Object.prototype.hasOwnProperty.call(patch, "autoMaterializeRuntimeSkills")) {
    current.autoMaterializeRuntimeSkills = patch.autoMaterializeRuntimeSkills;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "allowDelegatedSkillSyncToDirectReports")) {
    current.allowDelegatedSkillSyncToDirectReports = patch.allowDelegatedSkillSyncToDirectReports;
  }
  next.paperclipSkillSync = current;
  return next;
}
