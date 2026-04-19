import { describe, expect, it } from "vitest";
import { hasTeamEnabled, readTeamSettings, withTeamSettings } from "./team-settings";

describe("team settings metadata helpers", () => {
  it("reads defaults when metadata is missing", () => {
    expect(readTeamSettings(null)).toEqual({
      teamName: "",
      goal: "",
      parallelization: 1,
      performanceProfile: "balanced",
      conventions: "",
      prompt: "",
      enabled: undefined,
    });
  });

  it("merges settings while preserving existing metadata", () => {
    const next = withTeamSettings(
      { foo: "bar", paperclipTeam: { conventions: "old", prompt: "old" } },
      {
        teamName: "Platform Team",
        goal: "Improve issue throughput",
        parallelization: 4,
        performanceProfile: "quality",
        conventions: "Ship small PRs",
        prompt: "Focus on testability",
        enabled: true,
      },
    );

    expect(next).toEqual({
      foo: "bar",
      paperclipTeam: {
        teamName: "Platform Team",
        goal: "Improve issue throughput",
        parallelization: 4,
        performanceProfile: "quality",
        conventions: "Ship small PRs",
        prompt: "Focus on testability",
        enabled: true,
      },
    });
  });

  it("clamps invalid parallelization values", () => {
    expect(readTeamSettings({ paperclipTeam: { parallelization: 0 } }).parallelization).toBe(1);
    expect(readTeamSettings({ paperclipTeam: { parallelization: 99 } }).parallelization).toBe(12);
  });

  it("detects enabled flag", () => {
    expect(hasTeamEnabled({ paperclipTeam: { enabled: true } })).toBe(true);
    expect(hasTeamEnabled({ paperclipTeam: { enabled: false } })).toBe(false);
  });
});
