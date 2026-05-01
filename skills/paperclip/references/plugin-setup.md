# Plugin install and configuration (board API)

Use this flow when checking whether a plugin is installed, enabling it, validating secrets, and saving instance config. All routes require **board** authentication (session cookie or equivalent) unless noted.

## 1. Is it installed?

`GET /api/plugins`

Inspect the JSON array for a row with:

- `pluginKey`: `paperclip.linear-bridge` (Linear Webhook Bridge)
- `pluginKey`: `paperclip.obsidian-brain` (Obsidian Brain)

Note each row’s `id` (UUID) and `status` (`ready`, `disabled`, `error`, etc.).

## 2. Install (if missing)

`POST /api/plugins/install`

Body (local dev; use your absolute path):

```json
{
  "packageName": "<repo>/packages/plugins/plugin-linear-bridge",
  "isLocalPath": true
}
```

Same pattern for `plugin-obsidian-brain`. Bundled example metadata (package name, local path) matches `BUNDLED_PLUGIN_EXAMPLES` in `server/src/routes/plugins.ts`.

## 3. Enable

`POST /api/plugins/{pluginId}/enable`

`{pluginId}` may be the row UUID or the `pluginKey` string. Webhooks are only accepted when the plugin is **`ready`**.

## 4. Instance configuration

- `GET /api/plugins/{pluginId}/config` — returns saved config or null-ish if never saved.
- `POST /api/plugins/{pluginId}/config` — body: `{ "configJson": { ... } }` validated against the plugin manifest `instanceConfigSchema`.

### Linear Webhook Bridge (`paperclip.linear-bridge`)

Required in config:

- `webhookSigningSecretRef` — UUID of a **company secret** row whose value is the Linear webhook signing secret (not the raw secret string). See `doc/LINEAR-BRIDGE.md`.
- `companyId` — target company UUID.

Optional:

- `agentId` — agent that receives work. If omitted, the worker resolves a default from the company’s agents (CEO first, then first non-terminated agent).

Other fields (`promptTemplate`, `issueActions`, etc.) are optional with manifest defaults.

### Obsidian Brain (`paperclip.obsidian-brain`)

Required:

- `vaultRoot` — absolute path to the Obsidian vault on the Paperclip host.

Optional: `brainSubdir`, `orchestratorAgentIds`, `enforceMdExtension`, `maxReadBytes` (see manifest).

## 5. Secrets checklist (Linear)

1. Store the Linear signing secret as a Paperclip **company secret** for the same company as `companyId`.
2. Use that secret row’s **`id` (UUID)** as `webhookSigningSecretRef`.
3. Do not put the raw secret in `configJson` unless the schema explicitly allows it (this plugin expects a ref).

## 6. Optional validation

`POST /api/plugins/{pluginId}/config/test` — validates without persisting (plugin must be `ready` and support validation).
