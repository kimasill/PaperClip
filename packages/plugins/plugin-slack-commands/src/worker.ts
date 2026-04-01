import crypto from "node:crypto";
import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginWebhookInput,
} from "@paperclipai/plugin-sdk";
import { PLUGIN_ID } from "./manifest.js";

type SlackCommandsConfig = {
  signingSecretRef?: string;
  companyId?: string;
  agentId?: string;
  projectId?: string;
  commandPrefix?: string;
  allowChannels?: string[];
};

let currentContext: PluginContext | null = null;

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseFormUrlEncoded(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(rawBody);
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function computeSlackSignature(signingSecret: string, timestamp: string, rawBody: string): string {
  const base = `v0:${timestamp}:${rawBody}`;
  const hash = crypto.createHmac("sha256", signingSecret).update(base, "utf8").digest("hex");
  return `v0=${hash}`;
}

async function getConfig(ctx: PluginContext): Promise<Required<Pick<SlackCommandsConfig, "signingSecretRef" | "companyId" | "agentId">> & SlackCommandsConfig> {
  const config = (await ctx.config.get()) as SlackCommandsConfig;
  const signingSecretRef = asNonEmptyString(config?.signingSecretRef);
  const companyId = asNonEmptyString(config?.companyId);
  const agentId = asNonEmptyString(config?.agentId);
  if (!signingSecretRef) throw new Error("Missing config.signingSecretRef");
  if (!companyId) throw new Error("Missing config.companyId");
  if (!agentId) throw new Error("Missing config.agentId");
  return { ...config, signingSecretRef, companyId, agentId };
}

async function postToSlackResponseUrl(ctx: PluginContext, responseUrl: string, body: Record<string, unknown>): Promise<void> {
  await ctx.http.fetch(responseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
}

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;
    ctx.logger.info("Slack Commands plugin ready", { pluginId: PLUGIN_ID });
  },

  async onWebhook(input: PluginWebhookInput) {
    if (input.endpointKey !== "slash") {
      throw new Error(`Unsupported webhook endpoint "${input.endpointKey}"`);
    }

    const ctx = currentContext;
    if (!ctx) throw new Error("Plugin context not initialized");

    const config = await getConfig(ctx);

    const headers = Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ) as Record<string, string | string[]>;

    const slackSignature = Array.isArray(headers["x-slack-signature"])
      ? headers["x-slack-signature"][0]
      : headers["x-slack-signature"];
    const slackTimestamp = Array.isArray(headers["x-slack-request-timestamp"])
      ? headers["x-slack-request-timestamp"][0]
      : headers["x-slack-request-timestamp"];

    const sig = asNonEmptyString(slackSignature);
    const ts = asNonEmptyString(slackTimestamp);
    if (!sig || !ts) {
      throw new Error("Missing Slack signature headers");
    }

    // Reject replays: Slack recommends 5 minutes.
    const nowSec = Math.floor(Date.now() / 1000);
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > 60 * 5) {
      throw new Error("Slack request timestamp outside allowed window");
    }

    const signingSecret = await ctx.secrets.resolve(config.signingSecretRef);
    const expected = computeSlackSignature(signingSecret, ts, input.rawBody);
    if (!timingSafeEqualHex(expected, sig)) {
      throw new Error("Invalid Slack signature");
    }

    const form = parseFormUrlEncoded(input.rawBody);
    const text = asNonEmptyString(form.text) ?? "";
    const responseUrl = asNonEmptyString(form.response_url);
    const channelId = asNonEmptyString(form.channel_id);
    const userId = asNonEmptyString(form.user_id);

    const allowChannels = (config.allowChannels ?? []).map((c) => c.trim()).filter(Boolean);
    if (allowChannels.length > 0 && channelId && !allowChannels.includes(channelId)) {
      if (responseUrl) {
        await postToSlackResponseUrl(ctx, responseUrl, {
          response_type: "ephemeral",
          text: "이 채널에서는 Paperclip 명령을 실행할 수 없습니다.",
        });
      }
      return;
    }

    const prefix = asNonEmptyString(config.commandPrefix) ?? "";
    if (prefix && !text.startsWith(prefix)) {
      if (responseUrl) {
        await postToSlackResponseUrl(ctx, responseUrl, {
          response_type: "ephemeral",
          text: `명령 형식이 올바르지 않습니다. 예: \`${prefix} 결제 페이지 반응형 수정 후 PR 생성\``,
        });
      }
      return;
    }

    const normalizedText = prefix ? text.slice(prefix.length).trim() : text.trim();
    if (!normalizedText) {
      if (responseUrl) {
        await postToSlackResponseUrl(ctx, responseUrl, {
          response_type: "ephemeral",
          text: "실행할 작업 내용을 함께 보내주세요.",
        });
      }
      return;
    }

    const prompt = [
      "다음 Slack 지시를 수행해 주세요.",
      "",
      `- 요청자: ${userId ?? "unknown"}`,
      `- 채널: ${channelId ?? "unknown"}`,
      config.projectId ? `- projectId: ${config.projectId}` : null,
      "",
      "요구사항:",
      normalizedText,
      "",
      "완료 후:",
      "- 변경사항을 커밋하고 원격에 푸시합니다.",
      "- 가능하면 GitHub/GitLab에 PR/MR을 생성합니다(구성된 도구/플러그인이 있으면 사용).",
    ].filter(Boolean).join("\n");

    if (responseUrl) {
      await postToSlackResponseUrl(ctx, responseUrl, {
        response_type: "ephemeral",
        text: "작업을 시작합니다. 진행 상황은 Paperclip에서 확인해 주세요.",
      });
    }

    const result = await ctx.agents.invoke(config.agentId, config.companyId, {
      prompt,
      reason: "Slack slash command",
    });

    if (responseUrl) {
      await postToSlackResponseUrl(ctx, responseUrl, {
        response_type: "ephemeral",
        text: `에이전트 실행을 요청했습니다. runId: \`${result.runId}\``,
      });
    }
  },

  async onValidateConfig(config) {
    const typed = config as SlackCommandsConfig;
    const errors: string[] = [];
    if (!asNonEmptyString(typed.signingSecretRef)) errors.push("signingSecretRef is required");
    if (!asNonEmptyString(typed.companyId)) errors.push("companyId is required");
    if (!asNonEmptyString(typed.agentId)) errors.push("agentId is required");
    return { ok: errors.length === 0, errors };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

