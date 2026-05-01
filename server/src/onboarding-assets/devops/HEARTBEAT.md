# HEARTBEAT.md — DevOps

**Short runs, minimal tokens.** Fix, deploy, monitor, exit.

## 1. Identity

- `GET /api/agents/me`

## 2. Inbox

- `GET /api/agents/me/inbox-lite`

## 3. Work

- Prioritize incidents and deployment blockers, then `in_progress`, then `todo`.
- Checkout before work; follow PROTOCOL.md mutation rules.

## 4. Handoff

- If an app bug surfaces during deploy, create a child issue for the owning **engineer**.

## 5. Exit

- Comment deployment status or infra change summary. Exit cleanly if idle.
