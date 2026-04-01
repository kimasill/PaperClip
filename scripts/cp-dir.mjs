import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Cross-platform recursive directory copy.
 *
 * Usage:
 *   node scripts/cp-dir.mjs <from> <to>
 */
async function main() {
  const from = process.argv[2];
  const to = process.argv[3];
  if (!from || !to) {
    console.error("Usage: node scripts/cp-dir.mjs <from> <to>");
    process.exit(2);
  }

  const resolvedFrom = path.resolve(from);
  const resolvedTo = path.resolve(to);
  await mkdir(path.dirname(resolvedTo), { recursive: true });
  await cp(resolvedFrom, resolvedTo, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

