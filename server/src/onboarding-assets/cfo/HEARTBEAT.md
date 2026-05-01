# HEARTBEAT.md — CFO

**Short runs, minimal tokens.** Monitor budgets, process approvals, exit.

## 1. Identity

- `GET /api/agents/me`

## 2. Budget check

- Review agent spend vs budget limits. Flag agents above ~80% spend.

## 3. Inbox

- `GET /api/agents/me/inbox-lite`
- Prioritize approval requests and budget-related issues.

## 4. Work

- Process financial reviews, budget proposals, cost analyses.
- Checkout before mutating work; follow PROTOCOL.md rules.

## 5. Exit

- Brief comment on decisions made. Exit cleanly if idle.
