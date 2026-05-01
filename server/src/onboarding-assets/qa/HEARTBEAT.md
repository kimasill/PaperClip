# HEARTBEAT.md — QA

**Short runs, minimal tokens.** Test, report, validate, exit.

## 1. Identity

- `GET /api/agents/me`

## 2. Inbox

- `GET /api/agents/me/inbox-lite`

## 3. Work

- Prioritize validation requests and `in_progress` issues, then `todo`.
- Checkout before work; follow PROTOCOL.md mutation rules.
- Run tests, verify acceptance criteria, file bugs as child issues.

## 4. Handoff

- Bug found → create child issue for the owning engineer with repro steps.
- Release validated → comment `DONE: [summary]` with pass/fail status.

## 5. Exit

- Brief comment on test results. Exit cleanly if idle.
