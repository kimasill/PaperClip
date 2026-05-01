import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Github, KeyRound, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/api/client";
import { secretsApi } from "@/api/secrets";
import { useToast } from "@/context/ToastContext";
import { parseCompanySecretId } from "@/lib/gitlab-webhook-secret-config";
import { queryKeys } from "@/lib/queryKeys";

function randomWebhookSecretToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function uniqueSecretName(prefix: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix} ${suffix}`;
}

/** Surfaces API error body (not only the generic "Internal server error" string). */
function formatAssistError(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body as Record<string, unknown> | null | undefined;
    const errMsg = typeof body?.error === "string" ? body.error : e.message;
    const details = body?.details;
    const detailStr =
      details !== undefined
        ? ` — ${typeof details === "string" ? details : JSON.stringify(details).slice(0, 500)}`
        : "";
    return `${errMsg} (HTTP ${e.status})${detailStr}`;
  }
  return e instanceof Error ? e.message : String(e);
}

type GitProviderSecretAssistProps = {
  companyId: string;
  disabled: boolean;
  /** Merge patch into current form values and persist plugin config (save). */
  persistPatch: (patch: Record<string, unknown>) => Promise<void>;
};

/**
 * One-click flows for Git Provider: store GitHub/GitLab PATs and generate GitLab webhook secret
 * as company secrets, then set `githubTokenRef` / `gitlabTokenRef` / `gitlabWebhookSecretRef` to the new row ids.
 */
export function GitProviderSecretAssist({
  companyId,
  disabled,
  persistPatch,
}: GitProviderSecretAssistProps) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [ghPatOpen, setGhPatOpen] = useState(false);
  const [ghPatDraft, setGhPatDraft] = useState("");
  const [ghPatBusy, setGhPatBusy] = useState(false);

  const [patOpen, setPatOpen] = useState(false);
  const [patDraft, setPatDraft] = useState("");
  const [patBusy, setPatBusy] = useState(false);

  const [hookOpen, setHookOpen] = useState(false);
  const [hookToken, setHookToken] = useState<string | null>(null);
  const [hookBusy, setHookBusy] = useState(false);

  const invalidateSecrets = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(companyId) });
  }, [queryClient, companyId]);

  const handleStoreGithubPat = useCallback(async () => {
    const token = ghPatDraft.trim();
    if (!token) {
      pushToast({ title: "Paste your GitHub token", body: "The token value cannot be empty.", tone: "error" });
      return;
    }
    setGhPatBusy(true);
    try {
      const name = uniqueSecretName("GitHub PAT (Paperclip)");
      const created = await secretsApi.create(companyId, {
        name,
        value: token,
        description: "GitHub personal access token or fine-grained token for paperclip.git-provider.",
      });
      const id = parseCompanySecretId(created.id);
      await persistPatch({ githubTokenRef: id });
      setGhPatDraft("");
      setGhPatOpen(false);
      invalidateSecrets();
      pushToast({
        title: "GitHub token stored",
        body: "Company secret created and githubTokenRef updated. The raw token is only in the secret store.",
        tone: "success",
      });
    } catch (e) {
      pushToast({
        title: "Failed to store GitHub token",
        body: formatAssistError(e),
        tone: "error",
      });
    } finally {
      setGhPatBusy(false);
    }
  }, [ghPatDraft, companyId, persistPatch, pushToast, invalidateSecrets]);

  const handleStorePat = useCallback(async () => {
    const token = patDraft.trim();
    if (!token) {
      pushToast({ title: "Paste your GitLab PAT", body: "The token value cannot be empty.", tone: "error" });
      return;
    }
    setPatBusy(true);
    try {
      const name = uniqueSecretName("GitLab PAT (Paperclip)");
      const created = await secretsApi.create(companyId, {
        name,
        value: token,
        description: "GitLab personal access token for paperclip.git-provider (api, write_repository).",
      });
      const id = parseCompanySecretId(created.id);
      await persistPatch({ gitlabTokenRef: id });
      setPatDraft("");
      setPatOpen(false);
      invalidateSecrets();
      pushToast({
        title: "GitLab PAT stored",
        body: "Company secret created and gitlabTokenRef updated. The raw token is only in the secret store.",
        tone: "success",
      });
    } catch (e) {
      pushToast({
        title: "Failed to store PAT",
        body: formatAssistError(e),
        tone: "error",
      });
    } finally {
      setPatBusy(false);
    }
  }, [patDraft, companyId, persistPatch, pushToast, invalidateSecrets]);

  const handleGenerateWebhookSecret = useCallback(async () => {
    setHookBusy(true);
    setHookToken(null);
    try {
      const raw = randomWebhookSecretToken();
      const name = uniqueSecretName("GitLab MR webhook (Paperclip)");
      const created = await secretsApi.create(companyId, {
        name,
        value: raw,
        description: "Secret token for GitLab merge request webhooks (X-Gitlab-Token).",
      });
      const id = parseCompanySecretId(created.id);
      await persistPatch({ gitlabWebhookSecretRef: id });
      setHookToken(raw);
      setHookOpen(true);
      invalidateSecrets();
      pushToast({
        title: "Webhook secret registered",
        body: "Paste the token below into GitLab → Webhooks → Secret token, then save the webhook.",
        tone: "success",
      });
    } catch (e) {
      pushToast({ title: "Webhook secret failed", body: formatAssistError(e), tone: "error" });
    } finally {
      setHookBusy(false);
    }
  }, [companyId, persistPatch, pushToast, invalidateSecrets]);

  return (
    <>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-3 space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground/90">githubTokenRef</strong>,{" "}
          <strong className="text-foreground/90">gitlabTokenRef</strong>, and{" "}
          <strong className="text-foreground/90">gitlabWebhookSecretRef</strong> must be{" "}
          <strong className="text-foreground/90">company secret row ids</strong> (UUIDs), not raw PATs or webhook
          strings. Paste real tokens only in the dialogs below — Paperclip encrypts them and writes the id into the
          form for you.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || ghPatBusy}
            onClick={() => setGhPatOpen(true)}
          >
            <Github className="h-3.5 w-3.5 mr-1.5" />
            Store GitHub PAT…
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || patBusy}
            onClick={() => setPatOpen(true)}
          >
            <KeyRound className="h-3.5 w-3.5 mr-1.5" />
            Store GitLab PAT…
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || hookBusy}
            onClick={() => void handleGenerateWebhookSecret()}
          >
            <Webhook className="h-3.5 w-3.5 mr-1.5" />
            {hookBusy ? "Generating…" : "Generate GitLab webhook secret"}
          </Button>
        </div>
      </div>

      <Dialog open={ghPatOpen} onOpenChange={setGhPatOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Store GitHub token</DialogTitle>
            <DialogDescription>
              Paste your GitHub personal access token (classic or fine-grained with repo scope as needed). Paperclip
              stores it as a new company secret and sets <code className="text-xs">githubTokenRef</code> to that
              row&apos;s id. Do not paste the token into the text field below this box — only UUIDs belong there.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            className="min-h-[100px] font-mono text-xs"
            placeholder="ghp_xxxxxxxx… or github_pat_…"
            value={ghPatDraft}
            onChange={(e) => setGhPatDraft(e.target.value)}
            autoComplete="off"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setGhPatOpen(false)} disabled={ghPatBusy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleStoreGithubPat()} disabled={ghPatBusy}>
              {ghPatBusy ? "Saving…" : "Create secret & link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={patOpen} onOpenChange={setPatOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Store GitLab PAT</DialogTitle>
            <DialogDescription>
              Paste your GitLab personal access token (scopes: <code className="text-xs">api</code>,{" "}
              <code className="text-xs">write_repository</code>). Paperclip stores it as a new company secret and sets{" "}
              <code className="text-xs">gitlabTokenRef</code> to that row&apos;s id. The token is not kept in plugin
              config.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            className="min-h-[100px] font-mono text-xs"
            placeholder="glpat-xxxxxxxx…"
            value={patDraft}
            onChange={(e) => setPatDraft(e.target.value)}
            autoComplete="off"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setPatOpen(false)} disabled={patBusy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleStorePat()} disabled={patBusy}>
              {patBusy ? "Saving…" : "Create secret & link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={hookOpen} onOpenChange={setHookOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>GitLab webhook secret token</DialogTitle>
            <DialogDescription>
              Copy this value into GitLab → <strong>Settings → Webhooks</strong> → <strong>Secret token</strong>. It
              matches the company secret Paperclip just created;{" "}
              <strong className="text-foreground">save this dialog somewhere safe</strong> — it won&apos;t be shown
              again from Paperclip.
            </DialogDescription>
          </DialogHeader>
          {hookToken ? (
            <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/50 p-2 text-xs font-mono break-all">
              {hookToken}
            </pre>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            {hookToken ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(hookToken).then(
                    () => pushToast({ title: "Copied", body: "Paste it into GitLab’s webhook Secret token field.", tone: "success" }),
                    () => pushToast({ title: "Copy failed", body: "Select the token above and copy manually.", tone: "error" }),
                  );
                }}
              >
                Copy token
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setHookOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
