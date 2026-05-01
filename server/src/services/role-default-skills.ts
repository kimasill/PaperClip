/**
 * Default company-skill *reference strings* to merge on hire/create when `desiredSkills` is omitted.
 * Resolution is best-effort: unknown names are skipped (company may not have installed the skill yet).
 */
export function defaultSkillReferenceHintsForRole(role: string): string[] {
  // "obsidian-markdown" is best-effort: if the company hasn't installed/imported it yet,
  // resolution skips it. When present, it improves Obsidian Brain note quality.
  const coordination = ["paperclip", "obsidian-markdown"];
  switch (role) {
    case "ceo":
      return [...coordination, "paperclip-create-agent", "para-memory-files"];
    case "cto":
    case "cmo":
    case "cfo":
      return [...coordination, "paperclip-create-agent", "para-memory-files"];
    case "pm":
    case "researcher":
      return [...coordination, "para-memory-files"];
    case "engineer":
    case "devops":
      return [...coordination, "paperclip-create-plugin"];
    case "designer":
    case "qa":
      return coordination;
    default:
      return coordination;
  }
}
