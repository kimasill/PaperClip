import { describe, expect, it } from "vitest";
import {
  assertGitlabWebhookSecretRefApplied,
  isCompanySecretUuid,
  mergeGitProviderConfigForSave,
  parseCompanySecretId,
} from "./gitlab-webhook-secret-config";

describe("gitlab webhook secret config helpers", () => {
  it("parseCompanySecretId accepts valid UUIDs", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseCompanySecretId(id)).toBe(id);
    expect(parseCompanySecretId(`  ${id}  `)).toBe(id);
  });

  it("parseCompanySecretId rejects invalid values", () => {
    expect(() => parseCompanySecretId(undefined)).toThrow();
    expect(() => parseCompanySecretId("not-a-uuid")).toThrow();
  });

  it("assertGitlabWebhookSecretRefApplied passes when ref matches", () => {
    expect(() =>
      assertGitlabWebhookSecretRefApplied(
        { gitlabWebhookSecretRef: "550e8400-e29b-41d4-a716-446655440000" },
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).not.toThrow();
  });

  it("assertGitlabWebhookSecretRefApplied throws on mismatch", () => {
    expect(() =>
      assertGitlabWebhookSecretRefApplied(
        { gitlabWebhookSecretRef: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toThrow(/gitlabWebhookSecretRef was not persisted/);
  });

  it("isCompanySecretUuid rejects raw tokens and accepts UUIDs", () => {
    expect(isCompanySecretUuid("fj:!VIP#dfhd8i0nf")).toBe(false);
    expect(isCompanySecretUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isCompanySecretUuid("")).toBe(false);
  });

  it("mergeGitProviderConfigForSave strips invalid server webhook ref", () => {
    const out = mergeGitProviderConfigForSave(
      {
        gitlabWebhookSecretRef: "fj:!VIP#dfhd8i0nf",
        defaultGitlabApiBaseUrl: "https://gitlab.com/api/v4",
      },
      { gitlabTokenRef: "550e8400-e29b-41d4-a716-446655440000" },
    );
    expect(out.gitlabWebhookSecretRef).toBeUndefined();
    expect(out.gitlabTokenRef).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("mergeGitProviderConfigForSave preserves valid server webhook ref over form", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const out = mergeGitProviderConfigForSave(
      { gitlabWebhookSecretRef: uuid, gitlabTokenRef: "" },
      { gitlabTokenRef: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    );
    expect(out.gitlabWebhookSecretRef).toBe(uuid);
    expect(out.gitlabTokenRef).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });
});
