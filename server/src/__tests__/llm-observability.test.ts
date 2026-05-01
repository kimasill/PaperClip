import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitHeartbeatRunToLangfuse,
  extractHeartbeatLangfuseContext,
  isLangfuseObservabilityEnabled,
  resetLangfuseClientForTests,
} from "../services/llm-observability.js";

const traceSpy = vi.fn();
const generationSpy = vi.fn();
const flushAsyncSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("langfuse", () => ({
  Langfuse: vi.fn(() => ({
    trace: traceSpy,
    flushAsync: flushAsyncSpy,
  })),
}));

describe("extractHeartbeatLangfuseContext", () => {
  it("reads experimentKey and paperclipTeam from snapshots", () => {
    expect(
      extractHeartbeatLangfuseContext(
        { experimentKey: "team-ab-2026-04" },
        { paperclipTeam: { teamName: "Alpha", parallelization: 3, performanceProfile: "speed" } },
      ),
    ).toEqual({
      experimentKey: "team-ab-2026-04",
      teamName: "Alpha",
      teamPerformanceProfile: "speed",
      teamParallelization: 3,
    });
  });
});

describe("llm-observability", () => {
  beforeEach(() => {
    traceSpy.mockReset();
    generationSpy.mockReset();
    flushAsyncSpy.mockReset();
    traceSpy.mockReturnValue({ generation: generationSpy });
  });

  afterEach(() => {
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.PAPERCLIP_LANGFUSE_SECRET_KEY;
    delete process.env.PAPERCLIP_LANGFUSE_PUBLIC_KEY;
    resetLangfuseClientForTests();
  });

  it("is disabled when Langfuse keys are missing", () => {
    expect(isLangfuseObservabilityEnabled()).toBe(false);
  });

  it("is enabled when standard Langfuse keys are set", () => {
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    resetLangfuseClientForTests();
    expect(isLangfuseObservabilityEnabled()).toBe(true);
  });

  it("emitHeartbeatRunToLangfuse no-ops when disabled", async () => {
    await emitHeartbeatRunToLangfuse({
      runId: "00000000-0000-4000-8000-000000000001",
      companyId: "00000000-0000-4000-8000-000000000002",
      agentId: "00000000-0000-4000-8000-000000000003",
      agentName: "Test",
      adapterType: "claude-local",
      issueId: null,
      outcome: "succeeded",
      startedAt: new Date("2026-04-06T10:00:00.000Z"),
      finishedAt: new Date("2026-04-06T10:01:00.000Z"),
      adapterResult: {
        exitCode: 0,
        signal: null,
        timedOut: false,
        usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
        model: "test-model",
      },
      normalizedUsage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
    });
  });

  it("prefers externalRunId for Langfuse trace id", async () => {
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    resetLangfuseClientForTests();

    await emitHeartbeatRunToLangfuse({
      runId: "00000000-0000-4000-8000-000000000001",
      externalRunId: "trace-001-aaaaaaaa-bbbb-cccc-000000000000",
      companyId: "00000000-0000-4000-8000-000000000002",
      agentId: "00000000-0000-4000-8000-000000000003",
      agentName: "Test",
      adapterType: "claude-local",
      issueId: null,
      outcome: "succeeded",
      startedAt: new Date("2026-04-06T10:00:00.000Z"),
      finishedAt: new Date("2026-04-06T10:01:00.000Z"),
      adapterResult: {
        exitCode: 0,
        signal: null,
        timedOut: false,
        usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
        model: "test-model",
      },
      normalizedUsage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
    });

    expect(traceSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: "trace-001-aaaaaaaa-bbbb-cccc-000000000000",
      metadata: expect.objectContaining({
        paperclip: expect.objectContaining({
          heartbeatRunId: "00000000-0000-4000-8000-000000000001",
        }),
      }),
    }));
    expect(generationSpy).toHaveBeenCalledTimes(1);
    expect(flushAsyncSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to runId for Langfuse trace id when externalRunId is not set", async () => {
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    resetLangfuseClientForTests();

    await emitHeartbeatRunToLangfuse({
      runId: "00000000-0000-4000-8000-000000000001",
      companyId: "00000000-0000-4000-8000-000000000002",
      agentId: "00000000-0000-4000-8000-000000000003",
      agentName: "Test",
      adapterType: "claude-local",
      issueId: null,
      outcome: "failed",
      startedAt: new Date("2026-04-06T10:00:00.000Z"),
      finishedAt: new Date("2026-04-06T10:01:00.000Z"),
      adapterResult: {
        exitCode: 1,
        signal: null,
        timedOut: false,
        usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
        model: "test-model",
        errorCode: "adapter_failed",
      },
      normalizedUsage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
    });

    expect(traceSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: "00000000-0000-4000-8000-000000000001",
    }));
    expect(generationSpy).toHaveBeenCalledTimes(1);
  });

  it("sets Langfuse groupId and tags from experimentKey and team metadata", async () => {
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    resetLangfuseClientForTests();

    await emitHeartbeatRunToLangfuse({
      runId: "00000000-0000-4000-8000-000000000001",
      companyId: "00000000-0000-4000-8000-000000000002",
      agentId: "00000000-0000-4000-8000-000000000003",
      agentName: "Test",
      adapterType: "claude-local",
      issueId: null,
      outcome: "succeeded",
      startedAt: new Date("2026-04-06T10:00:00.000Z"),
      finishedAt: new Date("2026-04-06T10:01:00.000Z"),
      adapterResult: {
        exitCode: 0,
        signal: null,
        timedOut: false,
        usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
        model: "test-model",
      },
      normalizedUsage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
      experimentKey: "team-perf-test-2026",
      teamName: "Backend",
      teamPerformanceProfile: "quality",
      teamParallelization: 2,
    });

    expect(traceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "team-perf-test-2026",
        tags: expect.arrayContaining([
          "paperclip",
          "exp:team-perf-test-2026",
          "team:Backend",
          "perf:quality",
        ]),
        metadata: expect.objectContaining({
          paperclip: expect.objectContaining({
            experimentKey: "team-perf-test-2026",
            teamName: "Backend",
            teamPerformanceProfile: "quality",
            teamParallelization: 2,
          }),
        }),
      }),
    );
  });
});
