# Token and Secret Hardening Execution Package

## Context

This package defines the immediate security execution lane for GitLab token rotation, secret-ref migration, and runtime verification across the active blocker chain:

- [PIP-28](/PIP/issues/PIP-28)
- [PIP-54](/PIP/issues/PIP-54)
- [PIP-53](/PIP/issues/PIP-53)
- [PIP-18](/PIP/issues/PIP-18)

Reference contracts:

- `doc/DEVELOPING.md` secrets guidance
- `doc/GITLAB-APPROVAL-SYNC.md` GitLab webhook contract
- `packages/plugins/plugin-git-provider/src/worker.ts`

## Objective

Produce one repeatable verification path that answers three questions before the GitLab approval-sync lane is allowed to close:

1. Was the exposed GitLab token retired?
2. Are live GitLab credentials stored only as secret refs?
3. Does the runtime evidence prove the webhook path uses the configured secret-ref contract without leaking raw secrets?

## Sequencing

### Stage 1: Board remediation gate

Owner: board/runtime owner on [PIP-28](/PIP/issues/PIP-28) and [PIP-54](/PIP/issues/PIP-54)

- Revoke the exposed GitLab token and mint a replacement.
- Store the replacement in the company secrets manager.
- Re-save plugin/runtime config so GitLab credentials are referenced only through `gitlabTokenRef` and `gitlabWebhookSecretRef`.
- Post sanitized evidence only. No raw token values in comments, screenshots, logs, or copied config.

Exit criteria:

- Old token explicitly reported revoked.
- New token is stored as a secret ref, not inline config.
- Board evidence is posted in sanitized form.

### Stage 2: Runtime readiness gate

Owner: implementation/runtime lane on [PIP-53](/PIP/issues/PIP-53)

- Confirm the live `paperclip.git-provider` instance is on the upgraded manifest/runtime path.
- Confirm `gitlabWebhookSecretRef` is populated and webhook delivery is pointed at the live plugin endpoint.
- Trigger one real MR approval or unapproval delivery after config refresh.

Exit criteria:

- Runtime no longer fails due to missing webhook capability/config shape.
- Delivery evidence exists for one real GitLab event.
- No evidence artifact contains raw credential material.

### Stage 3: Security verification gate

Owner: security lane on [PIP-62](/PIP/issues/PIP-62) and [PIP-63](/PIP/issues/PIP-63)

- Run token-rotation verification after Stage 1 evidence lands.
- Run secret-ref migration verification after Stage 2 evidence lands.
- Post a concise pass/fail verdict and exact residual gaps.

Exit criteria:

- [PIP-62](/PIP/issues/PIP-62) closes with a clear token-rotation verdict.
- [PIP-63](/PIP/issues/PIP-63) closes with a clear secret-ref readiness verdict.
- Any remaining blocker is linked back to the owning issue.

## Actionable Checklist

### A. Token rotation checklist

- Confirm the exposure source is treated as compromised, not merely hidden.
- Confirm the old token was revoked, not just deleted from comments.
- Confirm the replacement token exists only in the secrets manager.
- Confirm `gitlabTokenRef` now points to the replacement secret ref.
- Confirm sanitized follow-through was posted to [PIP-21](/PIP/issues/PIP-21) and referenced from [PIP-18](/PIP/issues/PIP-18).
- Confirm no new comments or evidence bundles contain raw GitLab credentials.

### B. Secret-ref migration checklist

- Confirm live plugin/runtime config uses `gitlabTokenRef`, not an inline PAT.
- Confirm inbound webhook validation uses `gitlabWebhookSecretRef`.
- Confirm the configured ref names are non-empty and consistent with `doc/GITLAB-APPROVAL-SYNC.md`.
- Confirm runtime/config snapshots show references only, never resolved secret values.
- Confirm webhook delivery evidence does not echo raw `X-Gitlab-Token` material.

### C. Evidence hygiene checklist

- Redact token values fully, not partially.
- Prefer identifiers, timestamps, delivery IDs, and config keys over copied payload bodies.
- If screenshots are used, crop to the relevant field names and status only.
- If logs are used, include the surrounding verdict line and redact secret-bearing headers or env values.

## Evidence Template

Use this structure in board/runtime comments:

```md
## Security Update

- Scope: token rotation | secret-ref migration | runtime webhook validation
- Related issues: [PIP-28](/PIP/issues/PIP-28), [PIP-54](/PIP/issues/PIP-54), [PIP-53](/PIP/issues/PIP-53), [PIP-18](/PIP/issues/PIP-18)
- Timestamp: 2026-04-04T00:00:00Z
- Owner: board | runtime | security

### Evidence

- Secret ref key updated: `gitlabTokenRef` or `gitlabWebhookSecretRef`
- Runtime target: plugin id / webhook URL / GitLab delivery id
- Sanitized artifact: config snapshot, delivery result, or runtime log excerpt

### Verification

- Pass/Fail: PASS | FAIL | BLOCKED
- Residual gap:
- Next owner:
```

## Pass/Fail Criteria

### PASS

- Old exposed token is confirmed revoked.
- Live GitLab credentials are referenced through secret refs only.
- Runtime evidence shows one real delivery on the expected webhook path.
- All posted artifacts are sanitized.

### FAIL

- Any live config still embeds a raw token.
- Rotation evidence does not prove revocation of the old token.
- Evidence bundle includes raw secret material or partially exposed secrets.
- Webhook validation relies on undocumented or mismatched config.

### BLOCKED

- Board/runtime owner has not yet posted the required sanitized evidence.
- Live secret refs exist but cannot be validated from available runtime artifacts.
- Webhook test cannot run because runtime configuration is incomplete.

## Recommended Assignment Sequence

1. Complete board/runtime action on [PIP-28](/PIP/issues/PIP-28) and [PIP-54](/PIP/issues/PIP-54).
2. Resume runtime validation on [PIP-53](/PIP/issues/PIP-53) and implementation verification on [PIP-18](/PIP/issues/PIP-18).
3. Run token-rotation verdict in [PIP-62](/PIP/issues/PIP-62).
4. Run secret-ref migration verdict in [PIP-63](/PIP/issues/PIP-63).

This ordering avoids duplicate security reviews before the board/runtime evidence exists.
