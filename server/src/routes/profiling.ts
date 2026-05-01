import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { costEvents, heartbeatRuns } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const clamped = Math.max(0, Math.min(1, q));
  const idx = (sorted.length - 1) * clamped;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] ?? null;
  const left = sorted[lo] ?? 0;
  const right = sorted[hi] ?? 0;
  const t = idx - lo;
  return left + (right - left) * t;
}

function readUsageNumber(usage: Record<string, unknown> | null, ...keys: string[]): number {
  if (!usage) return 0;
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function readCostUsd(resultJson: Record<string, unknown> | null): number {
  if (!resultJson) return 0;
  const costUsd = (resultJson as any).costUsd;
  return typeof costUsd === "number" && Number.isFinite(costUsd) ? costUsd : 0;
}

export function profilingRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/profiling/experiments/:experimentKey/summary", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const experimentKey = asNonEmptyString(req.params.experimentKey);
    if (!experimentKey) {
      res.status(400).json({ error: "experimentKey is required" });
      return;
    }

    const agentId = asNonEmptyString(req.query.agentId);
    const from = parseIsoDate(req.query.from);
    const to = parseIsoDate(req.query.to);
    const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, limitRaw!)) : 1000;

    const experimentExpr = sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'experimentKey'`;

    const where = and(
      eq(heartbeatRuns.companyId, companyId),
      eq(experimentExpr, experimentKey),
      ...(agentId ? [eq(heartbeatRuns.agentId, agentId)] : []),
      ...(from ? [gte(heartbeatRuns.createdAt, from)] : []),
      ...(to ? [lte(heartbeatRuns.createdAt, to)] : []),
    );

    const rows = await db
      .select({
        id: heartbeatRuns.id,
        agentId: heartbeatRuns.agentId,
        status: heartbeatRuns.status,
        startedAt: heartbeatRuns.startedAt,
        finishedAt: heartbeatRuns.finishedAt,
        usageJson: heartbeatRuns.usageJson,
        resultJson: heartbeatRuns.resultJson,
        createdAt: heartbeatRuns.createdAt,
      })
      .from(heartbeatRuns)
      .where(where)
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(limit);

    const runIds = rows.map((r) => r.id);
    const costRows = runIds.length === 0
      ? []
      : await db
        .select({
          billingType: costEvents.billingType,
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
          inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::int`,
          cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::int`,
          runCount: sql<number>`count(distinct ${costEvents.heartbeatRunId})::int`,
        })
        .from(costEvents)
        .where(and(
          eq(costEvents.companyId, companyId),
          inArray(costEvents.heartbeatRunId, runIds),
          isNotNull(costEvents.heartbeatRunId),
        ))
        .groupBy(costEvents.billingType);

    let succeeded = 0;
    let failed = 0;
    let cancelled = 0;
    let timedOut = 0;
    let queuedOrRunning = 0;

    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let costUsd = 0;

    const latencyMsValues: number[] = [];
    const queueWaitMsValues: number[] = [];

    for (const row of rows) {
      if (row.status === "succeeded") succeeded += 1;
      else if (row.status === "failed") failed += 1;
      else if (row.status === "cancelled") cancelled += 1;
      else if (row.status === "timed_out") timedOut += 1;
      else if (row.status === "queued" || row.status === "running") queuedOrRunning += 1;

      const usage = (row.usageJson ?? null) as Record<string, unknown> | null;
      inputTokens += readUsageNumber(usage, "inputTokens", "input_tokens");
      outputTokens += readUsageNumber(usage, "outputTokens", "output_tokens");
      cachedInputTokens += readUsageNumber(
        usage,
        "cachedInputTokens",
        "cached_input_tokens",
        "cache_read_input_tokens",
      );

      const resultJson = (row.resultJson ?? null) as Record<string, unknown> | null;
      costUsd += readCostUsd(resultJson);

      if (row.startedAt && row.finishedAt) {
        const ms = row.finishedAt.getTime() - row.startedAt.getTime();
        if (Number.isFinite(ms) && ms >= 0) latencyMsValues.push(ms);
      }
      if (row.startedAt && row.createdAt) {
        const ms = row.startedAt.getTime() - row.createdAt.getTime();
        if (Number.isFinite(ms) && ms >= 0) queueWaitMsValues.push(ms);
      }
    }

    latencyMsValues.sort((a, b) => a - b);
    queueWaitMsValues.sort((a, b) => a - b);
    const p50 = quantile(latencyMsValues, 0.5);
    const p95 = quantile(latencyMsValues, 0.95);
    const avgLatencyMs =
      latencyMsValues.length > 0
        ? latencyMsValues.reduce((sum, v) => sum + v, 0) / latencyMsValues.length
        : null;
    const queueP50 = quantile(queueWaitMsValues, 0.5);
    const queueP95 = quantile(queueWaitMsValues, 0.95);
    const avgQueueWaitMs =
      queueWaitMsValues.length > 0
        ? queueWaitMsValues.reduce((sum, v) => sum + v, 0) / queueWaitMsValues.length
        : null;

    const completed = succeeded + failed + cancelled + timedOut;
    const successRate = completed > 0 ? succeeded / completed : null;

    res.json({
      companyId,
      experimentKey,
      agentId,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      limit,
      runCount: rows.length,
      completedCount: completed,
      succeeded,
      failed,
      cancelled,
      timedOut,
      queuedOrRunning,
      successRate,
      latencyMs: {
        sampleCount: latencyMsValues.length,
        p50,
        p95,
        avg: avgLatencyMs,
      },
      queueWaitMs: {
        sampleCount: queueWaitMsValues.length,
        p50: queueP50,
        p95: queueP95,
        avg: avgQueueWaitMs,
      },
      tokens: {
        input: inputTokens,
        cachedInput: cachedInputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      costUsd,
      costCents: costRows.reduce((sum, row) => sum + Number(row.costCents ?? 0), 0),
      costByBillingType: costRows
        .map((row) => ({
          billingType: row.billingType,
          runCount: Number(row.runCount ?? 0),
          costCents: Number(row.costCents ?? 0),
          inputTokens: Number(row.inputTokens ?? 0),
          cachedInputTokens: Number(row.cachedInputTokens ?? 0),
          outputTokens: Number(row.outputTokens ?? 0),
        }))
        .sort((a, b) => b.costCents - a.costCents),
    });
  });

  return router;
}

