# HEARTBEAT.md — Engineer

**Short runs, minimal tokens.** Implement, test, comment, exit.

## 1. Identity

- `GET /api/agents/me`

## 2. Inbox

- `GET /api/agents/me/inbox-lite`

## 3. Work

- Prioritize `in_progress`, then `todo`. Checkout before work (`POST .../checkout`; never retry 409).
- Implement the change, run tests if available, commit with clear message.

## 4. Handoff

- If code review is needed, comment with a summary and @-mention the reviewer.
- If blocked on design/spec, @-mention **ux_designer** or **pm**.

## 5. Exit

- Brief comment on what changed and what's next. Exit cleanly if idle.
