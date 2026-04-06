import path from "node:path";
import type { ObsidianBrainConfig } from "./config.js";

export type BrainRoots = {
  agentRoot: string;
  commonRoot: string;
  /** `{vault}/{brainSubdir}/{companyId}` — index and metadata live here */
  companyBrainBase: string;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Strip accidental wrapping quotes/backticks from pasted paths (e.g. JSON/UI storing `"C:\\…\\Vault"`).
 */
export function normalizeVaultRootInput(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/^["'`]+/, "").replace(/["'`]+$/, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

export function resolveBrainRoots(
  cfg: ObsidianBrainConfig,
  companyId: string,
): { vaultResolved: string; roots: BrainRoots } {
  const vaultRaw = asNonEmptyString(cfg.vaultRoot);
  if (!vaultRaw) {
    throw new Error("vaultRoot is not configured");
  }
  const vaultResolved = path.resolve(normalizeVaultRootInput(vaultRaw));
  const sub = asNonEmptyString(cfg.brainSubdir) ?? "PaperclipBrain";
  const companyBrainBase = path.resolve(vaultResolved, sub, companyId);
  return {
    vaultResolved,
    roots: {
      agentRoot: path.join(companyBrainBase, "agents"),
      commonRoot: path.join(companyBrainBase, "common"),
      companyBrainBase,
    },
  };
}

export function agentBrainDir(roots: BrainRoots, agentId: string): string {
  return path.join(roots.agentRoot, agentId);
}
