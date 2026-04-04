/**
 * Git Provider plugin: GitLab webhook secret ref must match `company_secrets.id`
 * (UUID). Used when applying the ref from "Generate Webhook Secret" and verifying
 * the server persisted it.
 */

export const COMPANY_SECRET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a non-empty `company_secrets.id` UUID string. */
export function isCompanySecretUuid(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const t = value.trim();
  return t.length > 0 && COMPANY_SECRET_UUID_RE.test(t);
}

/**
 * Merge persisted Git Provider config with form values for save/test.
 * - Preserves a valid host-managed `gitlabWebhookSecretRef` from the server so hidden
 *   schema defaults do not wipe it.
 * - Drops a legacy/invalid ref (e.g. raw GitLab Secret token) so API validation passes
 *   and the board can save other fields; they must use Generate Webhook Secret afterward.
 */
export function mergeGitProviderConfigForSave(
  server: Record<string, unknown> | null | undefined,
  formValues: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...(server ?? {}), ...formValues };
  const serverRef = server?.gitlabWebhookSecretRef;
  const serverRefValid =
    typeof serverRef === "string" && serverRef.trim() !== "" && isCompanySecretUuid(serverRef);
  if (serverRefValid) {
    merged.gitlabWebhookSecretRef = serverRef.trim();
    return merged;
  }
  const cur = merged.gitlabWebhookSecretRef;
  if (typeof cur === "string" && cur.trim() !== "" && !isCompanySecretUuid(cur)) {
    delete merged.gitlabWebhookSecretRef;
  }
  return merged;
}

/** Throws if the create-secret response id is not a UUID string. */
export function parseCompanySecretId(id: unknown): string {
  if (typeof id !== "string") {
    throw new Error("Company secret id is missing (expected string UUID).");
  }
  const trimmed = id.trim();
  if (!COMPANY_SECRET_UUID_RE.test(trimmed)) {
    throw new Error("Company secret id is not a valid UUID.");
  }
  return trimmed;
}

/**
 * Throws if persisted plugin config does not contain the expected ref.
 * Call with the JSON body returned from `POST /api/plugins/:id/config`.
 */
export function assertGitlabWebhookSecretRefApplied(
  configJson: Record<string, unknown>,
  expectedRef: string,
): void {
  const v = configJson.gitlabWebhookSecretRef;
  if (v !== expectedRef) {
    throw new Error(
      `gitlabWebhookSecretRef was not persisted (expected "${expectedRef}", got ${JSON.stringify(v)}).`,
    );
  }
}
