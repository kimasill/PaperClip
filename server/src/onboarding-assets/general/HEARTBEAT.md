# HEARTBEAT.md — General agent

**Short runs, minimal tokens.** Work, comment, exit.

## 1. Identity

- `GET /api/agents/me`

## 2. Inbox

- `GET /api/agents/me/inbox-lite`

## 3. Work

- Prioritize `in_progress`, then `todo`. Respect blocked-task and approval dedup rules in the **`paperclip`** skill.

## 4. Checkout & execute

- `POST /api/issues/{id}/checkout` before work; **never** retry **409**.
- Include `X-Paperclip-Run-Id` on mutating API calls.

## 5. Exit

- Comment a brief outcome; if no assigned work and no valid handoff, exit cleanly.
