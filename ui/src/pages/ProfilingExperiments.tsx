import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { profilingApi } from "../api/profiling";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { formatTokens, cn } from "../lib/utils";
import { billingTypeDisplayName, formatCents } from "../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function formatMs(value: number | null): string {
  if (value == null) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function formatPct(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 1000) / 10}%`;
}

export function ProfilingExperiments() {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? null;

  const [experimentKey, setExperimentKey] = useState("");
  const [agentId, setAgentId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState("1000");
  const [submittedKey, setSubmittedKey] = useState<string>("");

  const { data: agents } = useQuery({
    queryKey: companyId ? queryKeys.agents.list(companyId) : ["agents", "none"],
    queryFn: () => agentsApi.list(companyId!),
    enabled: !!companyId,
  });

  const effectiveLimit = useMemo(() => {
    const n = Number.parseInt(limit, 10);
    if (!Number.isFinite(n)) return 1000;
    return Math.max(1, Math.min(5000, n));
  }, [limit]);

  const summaryQuery = useQuery({
    queryKey: ["profiling", "experimentSummary", companyId, submittedKey, agentId, from, to, effectiveLimit],
    queryFn: () =>
      profilingApi.experimentSummary(companyId!, submittedKey, {
        agentId: agentId.trim() ? agentId.trim() : undefined,
        from: from.trim() ? new Date(from).toISOString() : undefined,
        to: to.trim() ? new Date(to).toISOString() : undefined,
        limit: effectiveLimit,
      }),
    enabled: !!companyId && submittedKey.length > 0,
    retry: false,
  });

  const summary = summaryQuery.data ?? null;
  const costCents = summary?.costCents ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Profiling</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Compare runs tagged with an <span className="font-mono">experimentKey</span> (latency p50/p95, tokens, success rate).
        </p>
      </div>

      <Card>
        <CardHeader className="px-5 pt-5 pb-2">
          <CardTitle className="text-base">Experiment query</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 px-5 pb-5 pt-2 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">experimentKey</div>
            <Input
              value={experimentKey}
              onChange={(e) => setExperimentKey(e.target.value)}
              placeholder="e.g. team-speed-vs-quality-2026-04-20"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Agent (optional)</div>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              disabled={!companyId}
            >
              <option value="">All agents</option>
              {(agents ?? [])
                .filter((a) => a.status !== "terminated")
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">From (optional)</div>
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">To (optional)</div>
            <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Limit</div>
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>

          <div className="flex items-end">
            <Button
              disabled={!companyId || experimentKey.trim().length === 0}
              onClick={() => setSubmittedKey(experimentKey.trim())}
            >
              Load summary
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-5 pt-5 pb-2">
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 px-5 pb-5 pt-2 md:grid-cols-2 xl:grid-cols-4">
          <div className={cn("border border-border p-4", summaryQuery.isFetching && "opacity-60")}>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Runs</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{summary ? summary.runCount : "—"}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              completed {summary ? summary.completedCount : "—"} · success {formatPct(summary?.successRate ?? null)}
            </div>
          </div>

          <div className={cn("border border-border p-4", summaryQuery.isFetching && "opacity-60")}>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Latency</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMs(summary?.latencyMs.p50 ?? null)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              p95 {formatMs(summary?.latencyMs.p95 ?? null)} · avg {formatMs(summary?.latencyMs.avg ?? null)}
            </div>
          </div>

          <div className={cn("border border-border p-4", summaryQuery.isFetching && "opacity-60")}>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Queue wait</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMs(summary?.queueWaitMs.p50 ?? null)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              p95 {formatMs(summary?.queueWaitMs.p95 ?? null)} · avg {formatMs(summary?.queueWaitMs.avg ?? null)}
            </div>
          </div>

          <div className={cn("border border-border p-4", summaryQuery.isFetching && "opacity-60")}>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Tokens</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{formatTokens(summary?.tokens.total ?? 0)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              in {formatTokens((summary?.tokens.input ?? 0) + (summary?.tokens.cachedInput ?? 0))} · out{" "}
              {formatTokens(summary?.tokens.output ?? 0)}
            </div>
          </div>

          <div className={cn("border border-border p-4", summaryQuery.isFetching && "opacity-60")}>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Cost (if reported)</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{summary ? formatCents(costCents) : "—"}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Uses server cost ledger (supports subscription + metered).
            </div>
          </div>
        </CardContent>
      </Card>

      {summary && summary.costByBillingType.length > 0 ? (
        <Card>
          <CardHeader className="px-5 pt-5 pb-2">
            <CardTitle className="text-base">Cost by billing type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-5 pb-5 pt-2">
            {summary.costByBillingType.map((row) => (
              <div
                key={row.billingType}
                className="flex items-start justify-between gap-3 border border-border px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {billingTypeDisplayName(row.billingType as any) ?? row.billingType}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.runCount} run(s) · in {formatTokens(row.inputTokens + row.cachedInputTokens)} · out{" "}
                    {formatTokens(row.outputTokens)}
                  </div>
                </div>
                <div className="text-right tabular-nums font-medium">{formatCents(row.costCents)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {summaryQuery.error ? (
        <p className="text-sm text-destructive">{(summaryQuery.error as Error).message}</p>
      ) : null}

      {!companyId ? (
        <p className="text-sm text-muted-foreground">Select a company first.</p>
      ) : null}
    </div>
  );
}

