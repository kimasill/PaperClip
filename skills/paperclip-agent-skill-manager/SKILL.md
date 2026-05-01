---
name: paperclip-agent-skill-manager
description: >
  Assign already-installed company skills to an existing agent, or include the
  same desiredSkills list during agent hire/create. Uses Paperclip APIs; does
  not install skills (use paperclip-skill-installer first).
---

# Paperclip Agent Skill Manager

Use this skill when you need to ensure an agent has the right skills **before** you assign work (or at hire time).

## Preconditions

- The target skill must already exist in the **company skill library**.
  - If not, install it first using `paperclip-skill-installer`.

## Core idea

1. Confirm what skills exist in the company.
2. Confirm what the agent currently desires/has.
3. Set the agent’s `desiredSkills` explicitly via the sync endpoint.

## Step 1 — Inspect company skills

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/skills" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

When selecting a skill reference to use in `desiredSkills`, prefer:

- exact company skill **key** (best)
- exact company skill **id**
- a **unique** slug (only if it is unique in this company)

If a reference is missing or ambiguous, the API returns `422`.

## Step 2 — Inspect the agent’s current skills snapshot

```sh
curl -sS "$PAPERCLIP_API_URL/api/agents/<agent-id>/skills" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

## Step 3 — Sync desired skills on an existing agent

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/agents/<agent-id>/skills/sync" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "desiredSkills": [
      "vercel-labs/skills/find-skills"
    ]
  }'
```

Notes:

- This sets the canonical desired skill keys on the agent.
- After sync, downstream runs should receive the correct runtime skill materialization (adapter-dependent).

## Hire/create with desiredSkills (preferred when staffing)

When hiring or creating an agent, include `desiredSkills` in the payload so the agent has skills on day one.

### Hire (governed)

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agent-hires" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Skill-ready agent",
    "role": "engineer",
    "title": "Engineer",
    "icon": "code",
    "reportsTo": "<manager-agent-id>",
    "adapterType": "codex_local",
    "adapterConfig": { "cwd": "/abs/path/to/repo" },
    "desiredSkills": ["vercel-labs/skills/find-skills"]
  }'
```

### Direct create (when allowed)

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agents" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Skill-ready agent",
    "role": "engineer",
    "adapterType": "codex_local",
    "adapterConfig": { "cwd": "/abs/path/to/repo" },
    "desiredSkills": ["vercel-labs/skills/find-skills"]
  }'
```

## Output expectation

When you finish, you should be able to state:

- target agent id/urlKey
- final desiredSkills list (canonical keys)
- any missing skills that must be installed at the company level first
