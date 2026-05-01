---
name: obsidian-brain
description: Use Paperclip Obsidian Brain plugin tools for vault notes; never read the vault with raw filesystem tools.
---

# Obsidian Brain (Paperclip)

## Rules

1. **Vault access**: Use only `obsidian_brain.*` tools. Never use generic Read/Write/Shell on vault paths.

2. **Proactive knowledge capture**: Save reusable artifacts and important findings to your agent brain folder **during and after every task**. Don't wait for explicit instructions — if something is worth remembering, write it.

3. **Wikilinks**: Connect related notes with `[[Note Title]]` syntax inside content. This enables Obsidian's graph navigation.

4. **Token budget**: Minimize prompt bloat — `list` first (scope + shallow subPath), then `read` only the 1–2 files you need. Never bulk-read your whole folder.

## Lifecycle

### Task start

1. `obsidian_brain.list` with `scope: agent` to see what you already know.
2. If a note title matches the current task topic, `obsidian_brain.read` it and reuse the context instead of rediscovering.
3. `obsidian_brain.list` with `scope: common` for shared team knowledge.

### During work

- When you produce a reusable element (snippet, decision, architecture note, API reference, config template), `obsidian_brain.write` or `obsidian_brain.append` it immediately.
- Link to related notes: `See also [[API Auth Flow]]` or `Depends on [[DB Migration 0046]]`.

### Task end

- Write a concise summary note if the task produced new knowledge that future runs can reuse.
- Append to existing notes rather than creating duplicates.

## Scopes

| Scope | Read | Write | Tool |
|-------|------|-------|------|
| Agent (`agents/{id}/`) | Any agent (own) | Own only | `write`, `append` |
| Common (`common/`) | Any agent | Allowed agents | `write_common` |

- `common/` writing is enabled for all agents when the admin turns on "Allow all agents to write common/" in plugin settings, otherwise only listed orchestrator IDs.
- Read shared notes via `obsidian_brain.read` with `common/` prefix (e.g. `common/weekly-digest.md`).

## Writing guidelines

- One concept per file, descriptive title: `api-auth-flow.md`, `react-component-patterns.md`.
- Front-matter is optional; keep content compact.
- Use `[[wikilinks]]` liberally for cross-referencing.
- Prefer append for incremental logs; use write for canonical reference docs.

## GitLab

Treat **edit → publish branch → open MR** as one delivery unit:

1. Apply code changes in the workspace.
2. Publish the branch: use the adapter **Bash/Shell tool** to run **`git checkout -b` / `git add` / `git commit` / `git push`** when terminal access exists; **or** `gitlab.create_branch` + `gitlab.create_commit` when only plugin HTTP is available.
3. Call `gitlab.create_merge_request` from the Git Provider plugin.

Optional: `gitlab.create_issue` with **`paperclipIssueId`** (current Paperclip issue UUID) to register the task on GitLab; append a one-line entry to your brain work log with the GitLab URL. See `doc/templates/agent-instructions-obsidian-brain.md`.
