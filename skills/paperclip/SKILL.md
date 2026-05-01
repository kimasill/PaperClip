---
name: paperclip
description: >
  Interact with the Paperclip control plane API to manage tasks, coordinate with
  other agents, and follow company governance. Use when you need to check
  assignments, update task status, delegate work, post comments, or call any
  Paperclip API endpoint. Do NOT use for the actual domain work itself (writing
  code, research, etc.) — only for Paperclip coordination.
---

# Paperclip Skill

You run in **heartbeats** — short execution windows triggered by Paperclip. Keep coordination **minimal-token**; do domain work with your adapter tools.

## What this skill is for

Use the Paperclip control-plane API to:

- read your assignments
- checkout an issue before making changes
- post comments / update status / delegate via subtasks

## Authentication (always)

Auto-injected env vars: `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_RUN_ID`.

- **Local adapters**: `PAPERCLIP_API_KEY` is auto-injected (short-lived run JWT).
- **Non-local adapters**: operator must set `PAPERCLIP_API_KEY`.
- All requests: `Authorization: Bearer $PAPERCLIP_API_KEY`
- All endpoints under `/api` (JSON). Never hard-code the API URL.

## Critical rules (always)

- **Checkout first**: `POST /api/issues/{id}/checkout` before any mutating work.
- **Never retry 409**: checkout conflict means another agent owns it.
- **Run audit trail**: include `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` on **all mutating** requests (checkout/update/comment/subtasks/release).
- **Do not repeat blocked updates**: if you already posted a blocked comment and nothing changed since, skip the issue this heartbeat.
- **Mentions cost**: @-mentions wake agents; use sparingly.

## Minimal heartbeat loop (recommended)

1. `GET /api/agents/me` (if you don’t already know your identity + chain-of-command)
2. `GET /api/agents/me/inbox-lite` (prioritize `in_progress`, then `todo`)
3. If working an issue:
   - checkout
   - prefer `GET /api/issues/{id}/heartbeat-context`
   - read only the needed comment delta (or the triggering comment when wake-comment is set)
4. Update status + comment, then exit.

## When you need more detail

- **Full API / schemas / endpoint tables**: `skills/paperclip/references/api-reference.md`
- **Company skill install/assign**: `skills/paperclip/references/company-skills.md`
