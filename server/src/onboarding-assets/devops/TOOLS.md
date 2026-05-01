# Tools & skills (DevOps)

| Skill | Use for |
|-------|---------|
| **`paperclip`** | Issues, checkout, comments, status updates; `X-Paperclip-Run-Id` on mutations. |
| **`paperclip-create-plugin`** | Company-specific plugins for CI/CD or monitoring integrations. |

## Plugin / webhook diagnostics (API)

Requires grants: `plugins:diagnose` (read) and `plugins:manage` (restart / test / retry). CEO/CTO/DevOps agents receive these on hire.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/plugins/:pluginId/webhook-deliveries?companyId=&limit=` | Recent inbound webhook delivery rows (status, error, timestamps). |
| GET | `/api/plugins/:pluginId/worker-health?companyId=` | Worker process status, PID, crash counts. |
| POST | `/api/plugins/:pluginId/worker-restart` body `{ companyId }` | Force worker restart. |
| POST | `/api/plugins/:pluginId/webhooks/:endpointKey/test` body `{ companyId, payload? }` | Dry-run `handleWebhook` with JSON payload. |
| POST | `/api/plugins/:pluginId/webhooks/:endpointKey/retry/:deliveryId` body `{ companyId }` | Re-deliver a stored failed delivery to the worker. |

**Domain work**: your adapter's tools (Bash, Read, Edit, etc.) for infrastructure, pipelines, configs, and deployment scripts.
