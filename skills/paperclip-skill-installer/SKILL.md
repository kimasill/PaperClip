---
name: paperclip-skill-installer
description: >
  Install and update skills in the Paperclip company skill library before work
  is assigned. Prefer Paperclip company skills API first; use the Skills CLI
  (`npx skills ...`) only as a low-cost discovery helper when needed.
---

# Paperclip Skill Installer

Use this skill when you are a CEO/manager/architect agent and you want to **pre-install** the skills that downstream agents will need.

## Goals

- Keep runtime predictable: downstream agents should not rely on heartbeat-time automatic skill discovery or installation.
- Control cost: avoid broad web search or large RAG runs when a precise skill reference is already known.

## Default Strategy (cost-first)

1. **Prefer explicit sources** you already have (from a task description, issue text, or known playbooks):
   - `https://skills.sh/<org>/<repo>/<skill>`
   - `<org>/<repo>/<skill>` (key-style)
   - `https://github.com/<org>/<repo>` (when not on skills.sh)
2. **Install into the company library** using Paperclip API.
3. **Only if you are missing a source string**, use `npx skills find <query>` to narrow candidates, then install via Paperclip.

## Paperclip API (preferred)

### List installed skills

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/skills" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

### Import / install a skill source

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/skills/import" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "vercel-labs/skills/find-skills"
  }'
```

Accepted `source` formats include:

- `https://skills.sh/org/repo/skill-name`
- `org/repo/skill-name`
- `https://github.com/org/repo`
- `npx skills add https://github.com/org/repo --skill skill-name` (parsed, not executed)
- local path (dev only)

### Check and install updates (GitHub / skills.sh managed)

1) Find the skill id (from the list output), then:

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/skills/<skill-id>/install-update" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

## Skills CLI (optional discovery helper)

Use this **only** when you do not yet have a good `source` string.

- **Budget guardrail**: run at most 1–3 queries per planning cycle; prefer narrow queries with constraints (tool, ecosystem, target).

Examples:

```sh
npx skills find "browser automation playwright"
npx skills find "gitlab ci pipeline patterns"
npx skills find "react performance nextjs vercel"
```

When you find the repo/skill, install via Paperclip API (do not rely on local-only install).

## How to decide search queries (make them precise)

Convert a task requirement into a query with:

- **Capability**: what the agent must do (e.g. “browser automation”, “security audit”, “bundle analysis”)
- **Tooling**: concrete tool/library (e.g. “playwright”, “vitest”, “pnpm”, “gitlab”)
- **Environment**: where it runs (e.g. “node”, “docker”, “windows”, “cursor”)

Bad: `testing`

Good:

- `vitest flaky tests`
- `pnpm monorepo dependency audit`
- `gitlab api issue sync`

## Output expectation (what you should produce)

When you finish pre-installation, you should be able to state:

- which skills were added/updated (by canonical key)
- which downstream agents should receive them (handled by a separate skill)
