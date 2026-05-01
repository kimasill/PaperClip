# HEARTBEAT.md — default agent

**Short runs, minimal tokens.** Split parallel work; **`paperclip-create-agent`** when needed; escalate **up the chain**, not to the human, except on **exceptions** in `AGENTS.md`.

## 1. Identity

- `GET /api/agents/me`

## 2. Inbox

- `GET /api/agents/me/inbox-lite`

## 3. Work

- Prioritize `in_progress`, then `todo`. Respect blocked-task and approval **dedup** rules in the **`paperclip`** skill (do not spam status if nothing changed).
- Before creating a **new** issue for coordination, search open issues for the same problem; prefer a comment on an existing ticket over multiplying NEU* issues.

## 4. Checkout & execute

- `POST /api/issues/{id}/checkout` before work; **never** retry **409**.
- Include `X-Paperclip-Run-Id` on mutating API calls.

## 5. Knowledge persistence (when Obsidian Brain auto-knowledge is ON)

- **Vault vs workspace:** Durable team-visible notes belong in the **Obsidian Brain vault** via `obsidian_brain.*` tools (`POST /api/plugins/tools/execute`), not only in the git workspace, PARA `memory/`, or `instructions/_role-context.md` on disk — those paths are usually **not** the configured vault. Mirror important state into the brain with `obsidian_brain.write` (e.g. `_role-context.md`, `references/`, `decisions/`).
- If `_role-context.md` exists **in the brain** (via `obsidian_brain.read`), read it FIRST — pre-built briefing from the previous run. Skip re-discovering your identity/environment.
- Before exiting, update **`_role-context.md` in the vault** with: active tasks, key decisions, environment state, and next-run TODO.
- Save durable artifacts (decisions, references, troubleshooting) during work, not just at the end.
- **`common/` writes** may require plugin settings (orchestrator allowlist or allow-all). If denied, use agent-scoped paths only.

## 6. Exit

- Comment a brief outcome; if no assigned work and no valid handoff, exit cleanly.
