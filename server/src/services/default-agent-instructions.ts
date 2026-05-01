import fs from "node:fs/promises";

/**
 * Standard onboarding tree under `server/src/onboarding-assets/<role>/`
 * for leadership + IC roles (see folders on disk).
 */
const STANDARD_ROLE_BUNDLE = ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"] as const;

/**
 * Which files to copy from onboarding-assets into a new agent managed bundle.
 * Keys must match directory names under `onboarding-assets/` (except `default`).
 */
const DEFAULT_AGENT_BUNDLE_FILES = {
  /** Fallback for unknown roles — only `default/` assets (no SOUL/TOOLS in repo). */
  default: ["AGENTS.md", "HEARTBEAT.md"],
  ceo: STANDARD_ROLE_BUNDLE,
  cto: STANDARD_ROLE_BUNDLE,
  cmo: STANDARD_ROLE_BUNDLE,
  cfo: STANDARD_ROLE_BUNDLE,
  engineer: STANDARD_ROLE_BUNDLE,
  designer: STANDARD_ROLE_BUNDLE,
  pm: STANDARD_ROLE_BUNDLE,
  qa: STANDARD_ROLE_BUNDLE,
  devops: STANDARD_ROLE_BUNDLE,
  researcher: STANDARD_ROLE_BUNDLE,
  general: STANDARD_ROLE_BUNDLE,
  /** Matches `server/src/onboarding-assets/ux_designer/` (hire/import may use this slug). */
  ux_designer: STANDARD_ROLE_BUNDLE,
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${role}/${fileName}`, import.meta.url);
}

const SHARED_COMPANY_CONVENTIONS_URL = new URL(
  "../onboarding-assets/shared/COMPANY_CONVENTIONS.md",
  import.meta.url,
);

export async function loadDefaultAgentInstructionsBundle(role: DefaultAgentBundleRole): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(resolveDefaultAgentBundleUrl(role, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  const bundle = Object.fromEntries(entries) as Record<string, string>;
  try {
    bundle["CONVENTIONS.md"] = await fs.readFile(SHARED_COMPANY_CONVENTIONS_URL, "utf8");
  } catch {
    // Shared conventions optional if file missing (e.g. trimmed deploy).
  }
  return bundle;
}

/**
 * Maps persisted `agents.role` to onboarding asset folder keys.
 * Unknown roles fall back to `default` (`onboarding-assets/default/`).
 */
export function resolveDefaultAgentInstructionsBundleRole(role: string): DefaultAgentBundleRole {
  const key = role.trim().toLowerCase();
  if ((key as DefaultAgentBundleRole) in DEFAULT_AGENT_BUNDLE_FILES && key !== "default") {
    return key as DefaultAgentBundleRole;
  }
  return "default";
}
