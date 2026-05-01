import { api } from "./client";

export type ExperimentSummary = {
  companyId: string;
  experimentKey: string;
  agentId: string | null;
  from: string | null;
  to: string | null;
  limit: number;
  runCount: number;
  completedCount: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  timedOut: number;
  queuedOrRunning: number;
  successRate: number | null;
  latencyMs: {
    sampleCount: number;
    p50: number | null;
    p95: number | null;
    avg: number | null;
  };
  queueWaitMs: {
    sampleCount: number;
    p50: number | null;
    p95: number | null;
    avg: number | null;
  };
  tokens: {
    input: number;
    cachedInput: number;
    output: number;
    total: number;
  };
  costUsd: number;
  costCents: number;
  costByBillingType: Array<{
    billingType: string;
    runCount: number;
    costCents: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  }>;
};

export const profilingApi = {
  experimentSummary: (companyId: string, experimentKey: string, opts?: {
    agentId?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (opts?.agentId) qs.set("agentId", opts.agentId);
    if (opts?.from) qs.set("from", opts.from);
    if (opts?.to) qs.set("to", opts.to);
    if (opts?.limit) qs.set("limit", String(opts.limit));
    const query = qs.toString();
    return api.get<ExperimentSummary>(
      `/companies/${encodeURIComponent(companyId)}/profiling/experiments/${encodeURIComponent(experimentKey)}/summary${query ? `?${query}` : ""}`,
    );
  },
};

