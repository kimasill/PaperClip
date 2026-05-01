import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { pluginWebhookDeliveries } from "@paperclipai/db";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";
import { logger } from "../middleware/logger.js";
import { randomUUID } from "node:crypto";

export const WEBHOOK_RETRY_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000] as const;
export const WEBHOOK_MAX_RETRY_ATTEMPTS = 5;

/**
 * After an inbound webhook delivery fails, schedule automatic retry with backoff.
 */
export async function scheduleWebhookRetry(db: Db, deliveryId: string, errorMessage: string): Promise<void> {
  const row = await db
    .select()
    .from(pluginWebhookDeliveries)
    .where(eq(pluginWebhookDeliveries.id, deliveryId))
    .then((r) => r[0] ?? null);
  if (!row) return;

  const attempt = (row.retryCount ?? 0) + 1;
  if (attempt > WEBHOOK_MAX_RETRY_ATTEMPTS) {
    await db
      .update(pluginWebhookDeliveries)
      .set({
        nextRetryAt: null,
        error: `${errorMessage} (max automatic retries exceeded)`,
      })
      .where(eq(pluginWebhookDeliveries.id, deliveryId));
    logger.warn({ deliveryId, pluginId: row.pluginId }, "webhook delivery: max retries exceeded");
    return;
  }

  const delayMs = WEBHOOK_RETRY_BACKOFF_MS[Math.min(attempt - 1, WEBHOOK_RETRY_BACKOFF_MS.length - 1)];
  await db
    .update(pluginWebhookDeliveries)
    .set({
      retryCount: attempt,
      nextRetryAt: new Date(Date.now() + delayMs),
      error: errorMessage,
    })
    .where(eq(pluginWebhookDeliveries.id, deliveryId));
}

/**
 * Process deliveries that are due for automatic retry.
 */
export async function processDueWebhookRetries(db: Db, workerManager: PluginWorkerManager): Promise<number> {
  const now = new Date();
  const due = await db
    .select()
    .from(pluginWebhookDeliveries)
    .where(
      and(
        eq(pluginWebhookDeliveries.status, "failed"),
        isNotNull(pluginWebhookDeliveries.nextRetryAt),
        lte(pluginWebhookDeliveries.nextRetryAt, now),
      ),
    );

  let completed = 0;
  for (const d of due) {
    const endpointKey = d.webhookKey;
    const requestId = randomUUID();
    const rawBody = JSON.stringify(d.payload ?? {});
    const startedAt = new Date();
    try {
      await workerManager.call(d.pluginId, "handleWebhook", {
        endpointKey,
        headers: d.headers as Record<string, string | string[]>,
        rawBody,
        parsedBody: d.payload,
        requestId,
      });
      const finishedAt = new Date();
      await db
        .update(pluginWebhookDeliveries)
        .set({
          status: "success",
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          finishedAt,
          error: null,
          nextRetryAt: null,
        })
        .where(eq(pluginWebhookDeliveries.id, d.id));
      completed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await scheduleWebhookRetry(db, d.id, message);
    }
  }
  return completed;
}

/**
 * Background loop: attempts due webhook retries periodically.
 */
export function startWebhookRetryLoop(db: Db, workerManager: PluginWorkerManager, intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    void processDueWebhookRetries(db, workerManager)
      .then((n) => {
        if (n > 0) {
          logger.info({ recovered: n }, "webhook automatic retries succeeded");
        }
      })
      .catch((err) => logger.warn({ err }, "webhook retry tick failed"));
  }, intervalMs);
  return () => clearInterval(timer);
}
