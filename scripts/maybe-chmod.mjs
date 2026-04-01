import { chmod } from "node:fs/promises";
import path from "node:path";

/**
 * Best-effort chmod for POSIX.
 * On Windows, this is a no-op.
 *
 * Usage:
 *   node scripts/maybe-chmod.mjs <file> <mode>
 *
 * Example:
 *   node scripts/maybe-chmod.mjs dist/index.js 755
 */
async function main() {
  const file = process.argv[2];
  const modeArg = process.argv[3] ?? "755";
  if (!file) {
    console.error("Usage: node scripts/maybe-chmod.mjs <file> <mode>");
    process.exit(2);
  }
  if (process.platform === "win32") return;
  const mode = parseInt(modeArg, 8);
  await chmod(path.resolve(file), mode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

