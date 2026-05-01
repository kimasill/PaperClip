import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@paperclipai/db";
import { companies } from "@paperclipai/db";
import { companySkillService } from "./company-skills.js";

export const OBSIDIAN_MARKDOWN_SKILL_REFERENCE = "obsidian-markdown";

/**
 * Prefer the bundled skill directory when running from a repo checkout.
 * Falls back to a skills.sh-style reference (GitHub-backed) when the directory is missing.
 */
export function resolveBundledObsidianMarkdownSkillDir(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(moduleDir, "../../..");
  const candidate = path.resolve(repoRoot, "skills", "obsidian-markdown");
  return existsSync(path.join(candidate, "SKILL.md")) ? candidate : null;
}

export async function ensureCompanyHasObsidianMarkdownSkill(
  db: Db,
  companyId: string,
): Promise<void> {
  const svc = companySkillService(db);

  // Fast path: already resolvable by reference.
  const existing = await svc.resolveOptionalSkillReferences(companyId, [OBSIDIAN_MARKDOWN_SKILL_REFERENCE]);
  if (existing.length > 0) return;

  const localDir = resolveBundledObsidianMarkdownSkillDir();
  const source = localDir ?? "kepano/obsidian-skills/obsidian-markdown";
  await svc.importFromSource(companyId, source);
}

export async function ensureAllCompaniesHaveObsidianMarkdownSkill(db: Db): Promise<void> {
  const rows = await db.select({ id: companies.id }).from(companies);
  for (const row of rows) {
    try {
      await ensureCompanyHasObsidianMarkdownSkill(db, row.id);
    } catch {
      // Best-effort: plugin install/enable shouldn't fail if skill import fails.
    }
  }
}

