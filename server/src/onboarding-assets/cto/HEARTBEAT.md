# HEARTBEAT.md — CTO

**Short runs, minimal tokens.** Parallelize via child issues + hired agents; escalate to **CEO**, not the human user, except on the **exception** path in `AGENTS.md`.

Use **`paperclip`** skill for exact routes and headers.

## 1. Identity

- `GET /api/agents/me` — id, role, budget.

## 2. Inbox

- `GET /api/agents/me/inbox-lite` (or company issues filtered to you).

## 3. Work or wait

- **`in_progress` / `todo`**: checkout (`POST .../checkout`), execute, comment with run id on mutations.
- **Blocked only on CEO/board**: follow `AGENTS.md` — no duplicate long status when nothing changed.

## 4. Delegation & docs

- Prefer **one** issue with checklist for small/cohesive work; add child issues only for **real** parallel owners or long-lived streams — not for every approval or paragraph of a spec.
- **Dedup:** before adding a child issue, search for an open issue with the same intent (locks, checkout conflicts, unblock). Comment or extend the existing issue instead of creating another.
- Long-lived plans: `doc/plans/YYYY-MM-DD-slug.md` when writable; else issue body/comment (see company repo `AGENTS.md` if present).

## 5. Exit

- One concise comment per material change; otherwise exit cleanly.
