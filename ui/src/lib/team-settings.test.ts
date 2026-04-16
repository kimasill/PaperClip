import { describe, expect, it } from "vitest";
import { hasTeamEnabled, readTeamSettings, withTeamSettings } from "./team-settings";

describe("team settings metadata helpers", () => {
  it("reads defaults when metadata is missing", () => {
    expect(readTeamSettings(null)).toEqual({ conventions: "", prompt: "", enabled: undefined });
  });

  it("merges settings while preserving existing metadata", () => {
    const next = withTeamSettings(
      { foo: "bar", paperclipTeam: { conventions: "old", prompt: "old" } },
      { conventions: "Ship small PRs", prompt: "Focus on testability", enabled: true },
    );

    expect(next).toEqual({
      foo: "bar",
      paperclipTeam: {
        conventions: "Ship small PRs",
        prompt: "Focus on testability",
        enabled: true,
      },
    });
  });

  it("detects enabled flag", () => {
    expect(hasTeamEnabled({ paperclipTeam: { enabled: true } })).toBe(true);
    expect(hasTeamEnabled({ paperclipTeam: { enabled: false } })).toBe(false);
  });
});
