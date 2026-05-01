/**
 * Claude Code accepts flags that `codex exec` rejects. Shared agent defaults
 * (for example `--enable-auto-mode` from the board UI) must not break Codex runs.
 */
export function filterCodexCompatibleExtraArgs(extraArgs: string[]): string[] {
  return extraArgs.filter((arg) => !/^--enable-auto-mode(?:=|$)/.test(arg));
}
