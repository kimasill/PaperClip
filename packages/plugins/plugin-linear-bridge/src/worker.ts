import crypto from "node:crypto";
import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginWebhookInput,
} from "@paperclipai/plugin-sdk";
import { PLUGIN_ID } from "./manifest.js";

type LinearBridgeConfig = {
  webhookSigningSecretRef?: string;
  companyId?: string;
  agentId?: string;
  promptTemplate?: string;
  issueActions?: string[];
  linearEventTypes?: string[];
  replayWindowMs?: number;
  taskTimeoutMs?: number;
};

type QueueItem = {
  enqueuedAt: string;
  deliveryId: string;
  linearEvent: string;
  action: string;
  issueId: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  team: string;
  state: string;
  priority: string;
};

const STATE_QUEUE = "linear_bridge_queue_v1";
const INSTANCE_SCOPE = { scopeKind: "instance" as const, stateKey: STATE_QUEUE };

let currentContext: PluginContext | null = null;

/** Serialize all queue mutations to avoid lost updates under concurrent webhooks. */
let queueMutex = Promise.resolve();

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function withQueueMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueMutex.then(fn, fn);
  queueMutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

type AgentRow = { id: string; role: string; status: string };

function pickDefaultAgentId(agents: AgentRow[]): string | null {
  const usable = agents.filter((a) => a.status !== "terminated");
  if (usable.length === 0) return null;
  const ceo = usable.find((a) => a.role === "ceo");
  return (ceo ?? usable[0]).id;
}

async function resolveAgentId(ctx: PluginContext, companyId: string, explicit: string | null): Promise<string> {
  if (explicit) return explicit;
  const rows = (await ctx.agents.list({ companyId, limit: 200, offset: 0 })) as AgentRow[];
  const id = pickDefaultAgentId(rows);
  if (!id) {
    throw new Error(
      "Linear bridge: no default agent — add an agent to this company or set config.agentId explicitly",
    );
  }
  return id;
}

async function getConfig(ctx: PluginContext): Promise<
  Required<Pick<LinearBridgeConfig, "webhookSigningSecretRef" | "companyId" | "agentId">> & LinearBridgeConfig
> {
  const raw = (await ctx.config.get()) as LinearBridgeConfig;
  const webhookSigningSecretRef = asNonEmptyString(raw?.webhookSigningSecretRef);
  const companyId = asNonEmptyString(raw?.companyId);
  const agentIdExplicit = asNonEmptyString(raw?.agentId);
  if (!webhookSigningSecretRef) throw new Error("Missing config.webhookSigningSecretRef");
  if (!companyId) throw new Error("Missing config.companyId");
  const agentId = await resolveAgentId(ctx, companyId, agentIdExplicit);
  return { ...raw, webhookSigningSecretRef, companyId, agentId };
}

function headerGet(headers: Record<string, string | string[]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

/**
 * Linear sends `Linear-Signature`: hex-encoded HMAC-SHA256 of the raw UTF-8 body.
 * @see https://linear.app/developers/webhooks#securing-webhooks
 */
function verifyLinearSignature(headerSignature: string | undefined, rawBody: string, secret: string): boolean {
  if (typeof headerSignature !== "string" || !headerSignature) return false;
  let headerBuf: Buffer;
  try {
    headerBuf = Buffer.from(headerSignature, "hex");
  } catch {
    return false;
  }
  const computed = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest();
  if (headerBuf.length !== computed.length) return false;
  return crypto.timingSafeEqual(computed, headerBuf);
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, val] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(val);
  }
  return out;
}

async function loadQueue(ctx: PluginContext): Promise<QueueItem[]> {
  const raw = await ctx.state.get(INSTANCE_SCOPE);
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is QueueItem => x && typeof x === "object");
}

async function saveQueue(ctx: PluginContext, q: QueueItem[]): Promise<void> {
  await ctx.state.set(INSTANCE_SCOPE, q);
}

async function enqueueItem(ctx: PluginContext, item: QueueItem): Promise<void> {
  await withQueueMutex(async () => {
    const q = await loadQueue(ctx);
    q.push(item);
    await saveQueue(ctx, q);
  });
}

async function dequeueOne(ctx: PluginContext): Promise<QueueItem | null> {
  return withQueueMutex(async () => {
    const q = await loadQueue(ctx);
    if (q.length === 0) return null;
    const [first, ...rest] = q;
    await saveQueue(ctx, rest);
    return first ?? null;
  });
}

async function runLinearTask(
  ctx: PluginContext,
  companyId: string,
  agentId: string,
  userPrompt: string,
  taskTimeoutMs: number,
): Promise<void> {
  const session = await ctx.agents.sessions.create(agentId, companyId, {
    reason: "Linear webhook bridge",
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Linear bridge task timed out"));
        }
      }, taskTimeoutMs);

      void ctx.agents.sessions.sendMessage(session.sessionId, companyId, {
        prompt: userPrompt,
        reason: "Linear webhook",
        onEvent: (event) => {
          if (event.eventType === "done") {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve();
            }
          }
          if (event.eventType === "error") {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              reject(new Error(event.message ?? "agent session error"));
            }
          }
        },
      });
    });
  } finally {
    await ctx.agents.sessions.close(session.sessionId, companyId).catch(() => {});
  }
}

let drainRunning = false;

async function drainQueue(ctx: PluginContext): Promise<void> {
  if (drainRunning) return;
  drainRunning = true;
  try {
    const cfg = await getConfig(ctx);
    const template =
      asNonEmptyString(cfg.promptTemplate) ??
      "Linear ticket {{identifier}}: {{title}}\n\n{{description}}\n\nURL: {{url}}";
    const taskTimeoutMs = typeof cfg.taskTimeoutMs === "number" && cfg.taskTimeoutMs > 0 ? cfg.taskTimeoutMs : 3600000;

    while (true) {
      const item = await dequeueOne(ctx);
      if (!item) break;

      const vars: Record<string, string> = {
        identifier: item.identifier,
        title: item.title,
        description: item.description,
        url: item.url,
        issueId: item.issueId,
        team: item.team,
        state: item.state,
        priority: item.priority,
        linearEvent: item.linearEvent,
        action: item.action,
        deliveryId: item.deliveryId,
      };
      const userPrompt = applyTemplate(template, vars);

      await ctx.activity.log({
        companyId: cfg.companyId,
        message: `Linear bridge: running queued task ${item.identifier}`,
        metadata: { plugin: PLUGIN_ID, deliveryId: item.deliveryId, issueId: item.issueId },
      });

      try {
        await runLinearTask(ctx, cfg.companyId, cfg.agentId, userPrompt, taskTimeoutMs);
        await ctx.activity.log({
          companyId: cfg.companyId,
          message: `Linear bridge: completed ${item.identifier}`,
          metadata: { plugin: PLUGIN_ID, deliveryId: item.deliveryId },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.activity.log({
          companyId: cfg.companyId,
          message: `Linear bridge: task failed for ${item.identifier}: ${msg}`,
          metadata: { plugin: PLUGIN_ID, deliveryId: item.deliveryId },
        });
      }
    }
  } finally {
    drainRunning = false;
  }
}

function parseIssuePayload(body: Record<string, unknown>, deliveryId: string): QueueItem | null {
  const type = asNonEmptyString(body.type);
  const action = asNonEmptyString(body.action);
  if (!type || !action) return null;

  const data = body.data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const issueId = asNonEmptyString(d.id);
  if (!issueId) return null;

  const teamObj = d.team;
  let team = "";
  if (teamObj && typeof teamObj === "object") {
    const t = teamObj as Record<string, unknown>;
    team = asNonEmptyString(t.name) ?? asNonEmptyString(t.key) ?? "";
  }

  const identifier = asNonEmptyString(d.identifier) ?? issueId.slice(0, 8);
  const title = asNonEmptyString(d.title) ?? "";
  const description = typeof d.description === "string" ? d.description : "";
  const url = asNonEmptyString(body.url) ?? "";
  const state = asNonEmptyString(d.state) ?? "";
  const priority = d.priority != null ? String(d.priority) : "";

  const id =
    asNonEmptyString(deliveryId) ?? asNonEmptyString(body.webhookId) ?? `unknown-${issueId}-${Date.now()}`;

  return {
    enqueuedAt: new Date().toISOString(),
    deliveryId: id,
    linearEvent: type,
    action,
    issueId,
    identifier,
    title,
    description,
    url,
    team,
    state,
    priority,
  };
}

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;
    ctx.logger.info("Linear bridge plugin ready", { pluginId: PLUGIN_ID });
  },

  async onWebhook(input: PluginWebhookInput) {
    if (input.endpointKey !== "linear") {
      throw new Error(`Unsupported webhook endpoint "${input.endpointKey}"`);
    }

    const ctx = currentContext;
    if (!ctx) throw new Error("Plugin context not initialized");

    const config = await getConfig(ctx);
    const secret = await ctx.secrets.resolve(config.webhookSigningSecretRef);

    const sig = headerGet(input.headers, "Linear-Signature");
    if (!verifyLinearSignature(sig, input.rawBody, secret)) {
      throw new Error("Invalid Linear-Signature");
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid JSON body");
    }

    const ts = parsed.webhookTimestamp;
    if (typeof ts !== "number" || !Number.isFinite(ts)) {
      throw new Error("Missing webhookTimestamp");
    }
    const replayWindowMs =
      typeof config.replayWindowMs === "number" && config.replayWindowMs > 0 ? config.replayWindowMs : 120000;
    if (Math.abs(Date.now() - ts) > replayWindowMs) {
      throw new Error("Webhook timestamp outside allowed window");
    }

    const linearEvent = headerGet(input.headers, "Linear-Event") ?? "";
    const eventFilterRaw = config.linearEventTypes;
    const eventFilter =
      eventFilterRaw === undefined
        ? ["Issue"]
        : eventFilterRaw.map((s) => String(s).trim()).filter(Boolean);
    if (eventFilter.length > 0 && linearEvent && !eventFilter.includes(linearEvent)) {
      return;
    }

    const action = asNonEmptyString(parsed.action) ?? "";
    const actionFilterRaw = config.issueActions;
    const actionFilter =
      actionFilterRaw === undefined
        ? ["create"]
        : actionFilterRaw.map((s) => String(s).trim()).filter(Boolean);
    if (actionFilter.length > 0 && !actionFilter.includes(action)) {
      return;
    }

    if (linearEvent === "Issue" || parsed.type === "Issue") {
      const deliveryHeader = headerGet(input.headers, "Linear-Delivery") ?? "";
      const item = parseIssuePayload(parsed, deliveryHeader);
      if (item) {
        await enqueueItem(ctx, item);
        void drainQueue(ctx).catch((err) => {
          ctx.logger.error("Linear bridge drain failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }
  },

  async onValidateConfig(config) {
    const typed = config as LinearBridgeConfig;
    const errors: string[] = [];
    if (!asNonEmptyString(typed.webhookSigningSecretRef)) errors.push("webhookSigningSecretRef is required");
    if (!asNonEmptyString(typed.companyId)) errors.push("companyId is required");
    return { ok: errors.length === 0, errors };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
