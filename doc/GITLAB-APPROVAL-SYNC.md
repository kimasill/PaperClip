# GitLab Approval Sync

`paperclip.git-provider` can mirror GitLab merge request approval webhooks into a linked Paperclip approval.

## Required config

- `gitlabTokenRef`: **UUID** of a Paperclip company secret (`company_secrets.id`) whose plaintext value is the GitLab API token used to create the merge request — not the token string in the plugin config field.
- `gitlabWebhookSecretRef`: **UUID** of a company secret whose plaintext equals GitLab’s webhook **Secret token**; the worker resolves it to validate `X-Gitlab-Token`.

### What `gitlabWebhookSecretRef` is (and is not)

Paperclip’s plugin host resolves `ctx.secrets.resolve(secretRef)` by looking up **`company_secrets.id`** in the database — the reference must be that **UUID string** (`plugin-secrets-handler.ts`).

| Correct | Wrong |
|--------|--------|
| `a1b2c3d4-e5f6-7890-abcd-ef1234567890` (id from the secrets list API) | GitLab’s raw “Secret token” pasted into the plugin field |
| Same UUID copied from `GET /api/companies/{companyId}/secrets` → each row’s `id` | `env:SOME_VAR`, `secret://…`, or other non-UUID strings |

**Flow:**

1. **Create** a company secret whose **value** is exactly the same string GitLab will use as **Secret token** (e.g. generate a random string; use it in both places).
2. **Copy the secret row’s `id`** (UUID) from the API response when you created it, or list secrets:  
   `GET /api/companies/{companyId}/secrets` (board session / `Cookie` auth) — each object includes `id`, `name`, etc. **Use `id` for the plugin field.**
3. In **GitLab → Webhooks → Secret token**, paste the **raw** token string (the secret’s value), not the UUID.
4. In **Paperclip → Instance → Plugins → Git Provider → config**, set **`gitlabWebhookSecretRef`** to the **UUID** from step 2 only.

If you paste the raw token into `gitlabWebhookSecretRef`, the host treats it as an invalid reference (`Invalid secret reference` / worker errors) because it is not a UUID.

**Note:** A **Cloudflare `text/plain` 502** with body `error code: 502` still indicates an **edge/origin** problem (see [Troubleshooting: HTTP 502](#troubleshooting-http-502-cloudflare)). Fixing the secret ref is required for **successful** webhook processing once POST reaches the API; it does not replace fixing infra if the response never reaches Express as JSON.

## Board and deployment

1. Create or pick a **company secret** whose value matches GitLab’s webhook **Secret token**. In **Settings → Plugins → Git Provider Tools**, set `gitlabWebhookSecretRef` to that secret’s **id (UUID)** from **Settings → Company secrets** — do not paste the raw secret token into the plugin field.
2. Copy the **Webhook Endpoints** URL for `gitlab` (`POST /api/plugins/<pluginId>/webhooks/gitlab`) into GitLab **Settings → Webhooks**, enable **Merge request events**, and use the same secret.
3. If the board opens on a different host than the URL GitLab must call (split UI/API, tunnel, or reverse proxy), set **`PAPERCLIP_PUBLIC_BASE_URL`** on the Paperclip API process to the public origin (e.g. `https://paperclip.example.com`, no trailing slash). The plugin detail API returns `publicInboundBaseUrl` so the UI can show the correct webhook URL.

### Example: tunnel host `https://paperclip.api.neuralmap.ing`

**1. Environment variable (API process only — not GitLab)**

Set exactly the **origin** (scheme + host). No path, no trailing slash:

```text
PAPERCLIP_PUBLIC_BASE_URL=https://paperclip.api.neuralmap.ing
```

**2. What GitLab must call**

GitLab’s **URL** field is **not** just the tunnel root. It must include Paperclip’s API path and your installed plugin’s id:

```text
https://paperclip.api.neuralmap.ing/api/plugins/<plugin-uuid>/webhooks/gitlab
```

Replace `<plugin-uuid>` with the value from the board: **Settings → Plugins → Git Provider Tools** → plugin row / details (UUID), or copy the full URL from **Webhook Endpoints** on that page after saving `PAPERCLIP_PUBLIC_BASE_URL` and restarting the API.

**3. Reverse proxy**

The tunnel must forward HTTPS for that host to the Paperclip process so that paths like `/api/plugins/...` reach the same server that serves the board (or the API only, if split — then the public host must still terminate at the API).

## Merge request creation contract

When creating a merge request with `gitlab.create_merge_request`, pass at least one of:

- `paperclipApprovalId`: explicit Paperclip approval UUID to resolve from webhook events.
- `paperclipIssueId`: Paperclip issue UUID. If `paperclipApprovalId` is omitted, the webhook bridge attempts to resolve exactly one pending approval linked to that issue.

The plugin stores a persistent mapping keyed by `<gitlab-project-id>:<mr-iid>`.

## Additional GitLab tools (automation)

Same plugin (`paperclip.git-provider`, package `@paperclipai/plugin-git-provider`):

- **`gitlab.create_issue`** — POST project issues (title, optional description, labels, assignees).
- **`gitlab.create_branch`** — POST repository branches (`branch`, `ref` source branch or SHA).
- **`gitlab.create_commit`** — POST [repository commits](https://docs.gitlab.com/ee/api/commits.html#create-a-commit-with-multiple-files-and-actions) with an `actions` array when agents cannot use local `git push`.

For `projectId`, prefer a numeric project id or a **single-encoded** path segment (e.g. pass `group/sub` so the client encodes once to `group%2Fsub`; avoid double-encoding an already-encoded string).

## Webhook contract

Configure GitLab to send a merge request webhook to:

`POST /api/plugins/<pluginId>/webhooks/gitlab`

`<pluginId>` may be the **install UUID** (from the board when you open that plugin) or the **manifest plugin key** `paperclip.git-provider`. It must exist on the **same** Paperclip instance/database that handles the request — a UUID from another PC or an old install returns `Plugin not found`.

The current implementation uses the merge request webhook payload and reads:

- `object_kind`: must be `merge_request`
- `project.id`: GitLab project identifier used in the mapping key
- `object_attributes.iid`: merge request IID
- `object_attributes.action`: sync trigger

Supported actions:

- `approved`: resolves the linked Paperclip approval as approved
- `unapproved`: resolves the linked Paperclip approval as rejected

Other merge request actions are ignored.

## Troubleshooting: HTTP 502 (Cloudflare)

A **502** from Cloudflare (often with `CF-RAY` in the response) means the **edge could not get a valid response from your origin** (Paperclip API process or the reverse proxy in front of it). It is **not** the same as Paperclip returning `400` for a bad webhook body or missing plugin — those only appear when the request **reaches** the API.

**Distinguish edge 502 vs application 502**

| Symptom | Meaning |
|--------|---------|
| `Content-Type: text/plain`, body like `error code: 502`, `Server: cloudflare` | **Cloudflare** could not reach or complete a response from the **origin**. Fix DNS, tunnel, load balancer, or the Paperclip process — **not** plugin config. |
| `Content-Type: application/json`, body includes `deliveryId`, `status`, `failed`, `error` | Request **reached** Paperclip; the plugin **worker** `handleWebhook` RPC failed. See server logs / plugin worker status. |

Example of an **edge** failure (from `curl -v`): `HTTP/1.1 502`, `Content-Type: text/plain; charset=UTF-8`, short body — no JSON from Paperclip.

**Unblock checklist (infra / board):**

1. **One canonical host** — GitLab’s webhook URL, `PAPERCLIP_PUBLIC_BASE_URL`, and the URL you use for `GET /api/health` must all use the **same scheme + host** that routes to a running API. Common confusion: `paper-api.neuralmap.ing` vs `paper.api.neuralmap.ing` vs `paperclip.api.neuralmap.ing` are **different DNS names**; only the one wired to your origin will work.
2. **Health first** — From your machine:  
   `curl -sS -o /dev/null -w "%{http_code}\n" https://<your-public-host>/api/health`  
   Expect **200** before testing `POST .../webhooks/gitlab`.
3. **Origin behind Cloudflare** — Confirm the tunnel / load balancer / `nginx` forwards `https://<host>/api/*` to the Paperclip server, TLS between Cloudflare and origin is valid (or “Full” with correct cert), and the process is up on the expected port.
4. **After the origin is healthy** — Retry the GitLab test delivery (or `curl` with `X-Gitlab-Event: Merge Request Hook`). Then you can compare responses with prior `400 webhooks.receive` cases and collect paired GitLab ↔ Paperclip evidence.

## Notes

- The webhook secret is matched against `X-Gitlab-Token`.
- Paperclip approval resolution is idempotent. If the approval is already terminal or no unique linked approval can be found, the webhook is logged and skipped.
- This implementation documents and relies on GitLab's merge request webhook action plus the merge request approvals API shape where approval state is represented around MR approval/unapproval events and `approved_by` entries in the approvals endpoint.
