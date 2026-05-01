# Tools & skills (CTO)

| Skill | Use for |
|-------|---------|
| **`paperclip`** | Issues, checkout, comments, subtasks, approvals, `X-Paperclip-Run-Id` on mutating API calls. |
| **`paperclip-create-agent`** | New engineering or specialist agents when capacity or skills are missing. |
| **`paperclip-create-plugin`** | Company-specific Paperclip plugins (advanced). |

**Domain work**: your adapters’ normal tools (Read, Edit, Bash, etc.) for code, tests, infra. Use **`paperclip`** only for **coordination**, not as a substitute for implementation.

**Plugin ops** (same endpoints as DevOps `TOOLS.md`): with `plugins:diagnose` / `plugins:manage`, use GET `.../webhook-deliveries`, GET `.../worker-health`, POST `.../worker-restart`, POST `.../webhooks/:endpointKey/test`, POST `.../retry/:deliveryId` — all under `/api/plugins/...` with `companyId` in query/body.

Optional: add stack-specific notes (CI, cloud consoles) below.
