import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Rocket, Users } from "lucide-react";
import { agentsApi, type OrgNode } from "../api/agents";
import { organizationsApi } from "../api/organizations";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "../context/ToastContext";
import {
  hasTeamEnabled,
  readTeamSettings,
  withTeamSettings,
  type CompactionIntensity,
  type DefaultOutputFormat,
  type RetryPolicy,
  type ReviewIntensity,
} from "../lib/team-settings";
import { useSearchParams } from "@/lib/router";
import { cn } from "@/lib/utils";

function collectLeadIds(nodes: OrgNode[], result: Set<string>) {
  for (const node of nodes) {
    if (node.reports.length > 0) result.add(node.id);
    collectLeadIds(node.reports, result);
  }
}

function collectDirectReportCounts(nodes: OrgNode[], map: Map<string, number>) {
  for (const node of nodes) {
    map.set(node.id, node.reports.length);
    collectDirectReportCounts(node.reports, map);
  }
}

function collectDescendants(nodes: OrgNode[], map: Map<string, string[]>) {
  const walk = (node: OrgNode): string[] => {
    const all: string[] = [];
    for (const child of node.reports) {
      all.push(child.id);
      all.push(...walk(child));
    }
    map.set(node.id, all);
    return all;
  };
  for (const root of nodes) walk(root);
}

const fieldLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const fieldHint = "text-[11px] text-muted-foreground/90 leading-snug";
const inputBase =
  "w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

export function TeamSettingsPanel({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [searchParams] = useSearchParams();
  const focusTeamLeadId = searchParams.get("teamLeadId");
  const focusSection = searchParams.get("section");
  const panelRef = useRef<HTMLDivElement | null>(null);

  const { data: orgTree } = useQuery({
    queryKey: queryKeys.org(companyId),
    queryFn: () => agentsApi.org(companyId),
    enabled: !!companyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  const { data: orgs } = useQuery({
    queryKey: queryKeys.organizations(companyId),
    queryFn: () => organizationsApi.list(companyId),
    enabled: !!companyId,
    retry: false,
  });

  const directReportCounts = useMemo(() => {
    const map = new Map<string, number>();
    collectDirectReportCounts(orgTree ?? [], map);
    return map;
  }, [orgTree]);

  const descendantsByLead = useMemo(() => {
    const map = new Map<string, string[]>();
    collectDescendants(orgTree ?? [], map);
    return map;
  }, [orgTree]);

  const teams = useMemo(() => {
    const leadIds = new Set<string>();
    collectLeadIds(orgTree ?? [], leadIds);
    for (const agent of agents ?? []) {
      if (hasTeamEnabled(agent.metadata)) leadIds.add(agent.id);
    }
    const byId = new Map((agents ?? []).map((agent) => [agent.id, agent]));
    return [...leadIds]
      .map((id) => byId.get(id))
      .filter((agent): agent is NonNullable<typeof agent> => !!agent)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orgTree, agents]);

  const [selectedLeadId, setSelectedLeadId] = useState<string>("");
  const selectedLead = teams.find((agent) => agent.id === selectedLeadId) ?? null;
  const teamSettings = useMemo(
    () => readTeamSettings(selectedLead?.metadata ?? null),
    [selectedLead],
  );
  const matchedOrg = useMemo(() => {
    if (!selectedLead || !orgs || orgs.length === 0) return null;
    const normalized = selectedLead.name.trim().toLowerCase();
    return (
      orgs.find((org) => org.level === "team" && org.name.trim().toLowerCase() === normalized) ??
      null
    );
  }, [orgs, selectedLead]);

  const [teamName, setTeamName] = useState("");
  const [goal, setGoal] = useState("");
  const [conventions, setConventions] = useState("");
  const [prompt, setPrompt] = useState("");
  const [parallelization, setParallelization] = useState(1);
  const [performanceProfile, setPerformanceProfile] = useState<"balanced" | "speed" | "quality">("balanced");
  const [applyToTeamAgents, setApplyToTeamAgents] = useState(true);

  const [allowedTools, setAllowedTools] = useState("");
  const [approvalsRequired, setApprovalsRequired] = useState(false);
  const [defaultOutputFormat, setDefaultOutputFormat] = useState<DefaultOutputFormat>("markdown");
  const [referenceScope, setReferenceScope] = useState("");
  const [costCapUsd, setCostCapUsd] = useState("");
  const [retryPolicy, setRetryPolicy] = useState<RetryPolicy>("standard");
  const [reviewIntensity, setReviewIntensity] = useState<ReviewIntensity>("normal");
  const [compactionIntensity, setCompactionIntensity] = useState<CompactionIntensity>("balanced");

  useEffect(() => {
    if (focusTeamLeadId && teams.some((team) => team.id === focusTeamLeadId) && selectedLeadId !== focusTeamLeadId) {
      setSelectedLeadId(focusTeamLeadId);
    } else if (!selectedLeadId && teams.length > 0) {
      setSelectedLeadId(teams[0]!.id);
    } else if (selectedLeadId && !teams.some((team) => team.id === selectedLeadId)) {
      setSelectedLeadId(teams[0]?.id ?? "");
    }
  }, [teams, selectedLeadId, focusTeamLeadId]);

  useEffect(() => {
    if ((focusSection === "teams" || !!focusTeamLeadId) && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focusSection, focusTeamLeadId]);

  useEffect(() => {
    setTeamName(teamSettings.teamName || (selectedLead ? `${selectedLead.name} Team` : ""));
    setGoal(teamSettings.goal);
    setConventions(teamSettings.conventions);
    setPrompt(teamSettings.prompt);
    setParallelization(teamSettings.parallelization);
    setPerformanceProfile(teamSettings.performanceProfile);
    setAllowedTools(teamSettings.allowedTools);
    setApprovalsRequired(teamSettings.approvalsRequired);
    setDefaultOutputFormat(teamSettings.defaultOutputFormat);
    setReferenceScope(teamSettings.referenceScope);
    setCostCapUsd(
      teamSettings.costMonthlyCapCents > 0 ? String(Math.round(teamSettings.costMonthlyCapCents / 100)) : "",
    );
    setRetryPolicy(teamSettings.retryPolicy);
    setReviewIntensity(teamSettings.reviewIntensity);
    setCompactionIntensity(teamSettings.compactionIntensity);
  }, [teamSettings, selectedLeadId, selectedLead]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLead) return;
      const normalizedParallelization = Math.min(12, Math.max(1, Math.round(parallelization)));
      const teamMemberIds = applyToTeamAgents
        ? [selectedLead.id, ...(descendantsByLead.get(selectedLead.id) ?? [])]
        : [selectedLead.id];
      const uniqueTeamMemberIds = [...new Set(teamMemberIds)];

      const usdRaw = costCapUsd.trim();
      const usd = usdRaw.length === 0 ? 0 : Number.parseFloat(usdRaw.replace(/,/g, ""));
      const costMonthlyCapCents =
        Number.isFinite(usd) && usd >= 0 ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(usd * 100)) : 0;

      const teamMetadata = withTeamSettings(selectedLead.metadata, {
        teamName: teamName.trim(),
        goal: goal.trim(),
        parallelization: normalizedParallelization,
        performanceProfile,
        conventions,
        prompt,
        enabled: true,
        allowedTools,
        approvalsRequired,
        defaultOutputFormat,
        referenceScope,
        costMonthlyCapCents,
        retryPolicy,
        reviewIntensity,
        compactionIntensity,
      });
      const selectedLeadAgent = (agents ?? []).find((agent) => agent.id === selectedLead.id) ?? null;
      if (selectedLeadAgent) {
        const currentAdapterConfig =
          typeof selectedLeadAgent.adapterConfig === "object" && selectedLeadAgent.adapterConfig
            ? selectedLeadAgent.adapterConfig
            : {};
        const currentRuntimeConfig =
          typeof selectedLeadAgent.runtimeConfig === "object" && selectedLeadAgent.runtimeConfig
            ? selectedLeadAgent.runtimeConfig
            : {};
        await agentsApi.update(
          selectedLead.id,
          {
            metadata: teamMetadata,
            adapterConfig: {
              ...currentAdapterConfig,
              thinkingEffort:
                performanceProfile === "quality"
                  ? "high"
                  : performanceProfile === "speed"
                    ? "low"
                    : "medium",
            },
            runtimeConfig: {
              ...currentRuntimeConfig,
              heartbeat: {
                ...(typeof currentRuntimeConfig.heartbeat === "object" && currentRuntimeConfig.heartbeat
                  ? (currentRuntimeConfig.heartbeat as Record<string, unknown>)
                  : {}),
                maxConcurrentRuns: normalizedParallelization,
              },
            },
          },
          companyId,
        );
      }

      if (applyToTeamAgents) {
        await Promise.all(
          uniqueTeamMemberIds
            .filter((agentId) => agentId !== selectedLead.id)
            .map(async (agentId) => {
              const agent = (agents ?? []).find((item) => item.id === agentId);
              if (!agent) return;
              const adapterConfig =
                typeof agent.adapterConfig === "object" && agent.adapterConfig ? agent.adapterConfig : {};
              const runtimeConfig =
                typeof agent.runtimeConfig === "object" && agent.runtimeConfig ? agent.runtimeConfig : {};
              await agentsApi.update(
                agent.id,
                {
                  adapterConfig: {
                    ...adapterConfig,
                    thinkingEffort:
                      performanceProfile === "quality"
                        ? "high"
                        : performanceProfile === "speed"
                          ? "low"
                          : "medium",
                  },
                  runtimeConfig: {
                    ...runtimeConfig,
                    heartbeat: {
                      ...(typeof runtimeConfig.heartbeat === "object" && runtimeConfig.heartbeat
                        ? (runtimeConfig.heartbeat as Record<string, unknown>)
                        : {}),
                      maxConcurrentRuns: normalizedParallelization,
                    },
                  },
                },
                companyId,
              );
            }),
        );
      }

      if (matchedOrg && teamName.trim() && teamName.trim() !== matchedOrg.name) {
        await organizationsApi.update(companyId, matchedOrg.id, { name: teamName.trim() });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.org(companyId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.organizations(companyId) });
      pushToast({ tone: "success", title: "Team settings saved" });
    },
    onError: (error) => {
      pushToast({
        tone: "error",
        title: "Failed to save team settings",
        body: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  const [newLeadId, setNewLeadId] = useState("");
  const enableTeamMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const agent = (agents ?? []).find((item) => item.id === agentId);
      if (!agent) return;
      const existing = readTeamSettings(agent.metadata);
      const metadata = withTeamSettings(agent.metadata, {
        ...existing,
        teamName: existing.teamName || `${agent.name} Team`,
        enabled: true,
      });
      await agentsApi.update(agent.id, { metadata }, companyId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.org(companyId) });
      setNewLeadId("");
      pushToast({ tone: "success", title: "Team enabled" });
    },
  });

  const teamIds = new Set(teams.map((team) => team.id));
  const availableLeads = (agents ?? [])
    .filter((agent) => agent.status !== "terminated" && !teamIds.has(agent.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      ref={panelRef}
      id="team-settings"
      className="w-full space-y-4 rounded-lg border border-border bg-card/30 px-4 py-4"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold tracking-tight">Teams</h3>
        <p className="text-xs text-muted-foreground">
          팀 리드별로 목표·프롬프트·도구·병렬도·승인·비용 상한 등을 구성합니다. 값은 에이전트{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">metadata.paperclipTeam</code>에
          저장됩니다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={cn(inputBase, "h-9 min-w-[220px]")}
          value={newLeadId}
          onChange={(event) => setNewLeadId(event.target.value)}
        >
          <option value="">에이전트에서 팀 켜기…</option>
          {availableLeads.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={!newLeadId || enableTeamMutation.isPending}
          onClick={() => enableTeamMutation.mutate(newLeadId)}
        >
          Enable Team
        </Button>
      </div>

      {teams.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          아직 팀이 없습니다. 에이전트에서 팀을 켜거나 Org Chart에서 직속 보고 관계를 만드세요.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                  selectedLeadId === team.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                )}
                onClick={() => setSelectedLeadId(team.id)}
              >
                <Users className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">{team.name}</span>
                <span className="text-[10px] opacity-70">({directReportCounts.get(team.id) ?? 0})</span>
              </button>
            ))}
          </div>

          {selectedLead ? (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                팀 리드: <span className="font-medium text-foreground">{selectedLead.name}</span>
              </p>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="gap-0 py-0 shadow-none">
                  <CardHeader className="border-b border-border/60 pb-3 pt-4">
                    <CardTitle className="text-sm">팀 이름</CardTitle>
                    <CardDescription className="text-xs">조직·사이드바에 표시되는 라벨</CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4 pt-3">
                    <input
                      className={cn(inputBase, "h-9")}
                      value={teamName}
                      onChange={(event) => setTeamName(event.target.value)}
                      placeholder={`${selectedLead.name} Team`}
                    />
                  </CardContent>
                </Card>

                <Card className="gap-0 py-0 shadow-none lg:col-span-2">
                  <CardHeader className="border-b border-border/60 pb-3 pt-4">
                    <CardTitle className="text-sm">목표 · 프롬프트</CardTitle>
                    <CardDescription className="text-xs">
                      팀마다 목표 문장과 공유 프롬프트를 다르게 둘 수 있습니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 pb-4 pt-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <span className={fieldLabel}>목표</span>
                      <p className={fieldHint}>분기·스프린트 목표, 측정 지표 한 줄 등</p>
                      <textarea
                        className={cn(inputBase, "min-h-[88px] resize-y")}
                        value={goal}
                        onChange={(event) => setGoal(event.target.value)}
                        placeholder="예: 이번 분기 P95 하트비트 지연 20% 개선"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <span className={fieldLabel}>팀 프롬프트</span>
                      <p className={fieldHint}>모든 팀원 에이전트에 공통으로 붙일 톤·우선순위·금지 사항</p>
                      <textarea
                        className={cn(inputBase, "min-h-[88px] resize-y")}
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="예: 사용자 대면 문구는 한국어, 코드 주석은 영어…"
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <span className={fieldLabel}>팀 규약 · 컨벤션</span>
                      <p className={fieldHint}>리뷰 규칙, 브랜치 전략, 릴리즈 정책 등 (선택)</p>
                      <textarea
                        className={cn(inputBase, "min-h-[72px] resize-y")}
                        value={conventions}
                        onChange={(event) => setConventions(event.target.value)}
                        placeholder="예: PR은 400줄 이하, 이슈 링크 필수…"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="gap-0 py-0 shadow-none">
                  <CardHeader className="border-b border-border/60 pb-3 pt-4">
                    <CardTitle className="text-sm">허용 도구 집합</CardTitle>
                    <CardDescription className="text-xs">도구 이름을 줄바꿈 또는 쉼표로 구분</CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4 pt-3">
                    <textarea
                      className={cn(inputBase, "min-h-[100px] resize-y font-mono text-xs")}
                      value={allowedTools}
                      onChange={(event) => setAllowedTools(event.target.value)}
                      placeholder={"bash\nread_file\nstr_replace\n…"}
                    />
                  </CardContent>
                </Card>

                <Card className="gap-0 py-0 shadow-none">
                  <CardHeader className="border-b border-border/60 pb-3 pt-4">
                    <CardTitle className="text-sm">기본 산출물 형식</CardTitle>
                    <CardDescription className="text-xs">리포트·이슈 코멘트 등 기본 포맷</CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4 pt-3">
                    <select
                      className={cn(inputBase, "h-9")}
                      value={defaultOutputFormat}
                      onChange={(event) => setDefaultOutputFormat(event.target.value as DefaultOutputFormat)}
                    >
                      <option value="markdown">Markdown</option>
                      <option value="plain_text">Plain text</option>
                      <option value="json">JSON</option>
                      <option value="mixed">Mixed / structured</option>
                    </select>
                  </CardContent>
                </Card>

                <Card className="gap-0 py-0 shadow-none">
                  <CardHeader className="border-b border-border/60 pb-3 pt-4">
                    <CardTitle className="text-sm">최대 병렬도 · 성능 프로필</CardTitle>
                    <CardDescription className="text-xs">
                      하트비트 동시 실행 상한과 어댑터 thinking 레벨
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pb-4 pt-3">
                    <div className="space-y-2">
                      <span className={fieldLabel}>최대 병렬도 (1–12)</span>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={1}
                          max={12}
                          value={parallelization}
                          onChange={(event) => setParallelization(Number(event.target.value))}
                          className="flex-1 accent-primary"
                        />
                        <span className="w-8 text-right text-sm font-medium tabular-nums">{parallelization}</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <span className={fieldLabel}>성능 프로필</span>
                      <select
                        className={cn(inputBase, "h-9")}
                        value={performanceProfile}
                        onChange={(event) =>
                          setPerformanceProfile(event.target.value as "balanced" | "speed" | "quality")
                        }
                      >
                        <option value="balanced">Balanced</option>
                        <option value="speed">Speed</option>
                        <option value="quality">Quality</option>
                      </select>
                    </div>
                    <label className="flex cursor-pointer items-start gap-2.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border border-input"
                        checked={applyToTeamAgents}
                        onChange={(event) => setApplyToTeamAgents(event.target.checked)}
                      />
                      <span>
                        병렬도·성능 프로필을 팀원 에이전트에도 적용{" "}
                        <span className="text-muted-foreground/80">(메타데이터는 리드에만 저장)</span>
                      </span>
                    </label>
                  </CardContent>
                </Card>

                <Card className="gap-0 py-0 shadow-none">
                  <CardHeader className="border-b border-border/60 pb-3 pt-4">
                    <CardTitle className="text-sm">승인 · 재시도 · 리뷰 · 압축</CardTitle>
                    <CardDescription className="text-xs">거버넌스와 품질·컨텍스트 강도 정책</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 pb-4 pt-3 sm:grid-cols-2">
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border/60 bg-muted/20 p-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border border-input"
                        checked={approvalsRequired}
                        onChange={(event) => setApprovalsRequired(event.target.checked)}
                      />
                      <div>
                        <div className="text-xs font-medium text-foreground">승인 필요</div>
                        <p className={cn(fieldHint, "mt-0.5")}>
                          민감 작업 전 사람 승인(워크플로 설계 시 참고용 메타)
                        </p>
                      </div>
                    </label>
                    <div className="space-y-1.5">
                      <span className={fieldLabel}>재시도 정책</span>
                      <select
                        className={cn(inputBase, "h-9")}
                        value={retryPolicy}
                        onChange={(event) => setRetryPolicy(event.target.value as RetryPolicy)}
                      >
                        <option value="none">없음</option>
                        <option value="conservative">보수적</option>
                        <option value="standard">표준</option>
                        <option value="aggressive">적극</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <span className={fieldLabel}>리뷰 강도</span>
                      <select
                        className={cn(inputBase, "h-9")}
                        value={reviewIntensity}
                        onChange={(event) => setReviewIntensity(event.target.value as ReviewIntensity)}
                      >
                        <option value="light">가벼움</option>
                        <option value="normal">보통</option>
                        <option value="strict">엄격</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <span className={fieldLabel}>요약 · 압축 강도</span>
                      <select
                        className={cn(inputBase, "h-9")}
                        value={compactionIntensity}
                        onChange={(event) => setCompactionIntensity(event.target.value as CompactionIntensity)}
                      >
                        <option value="minimal">최소</option>
                        <option value="balanced">균형</option>
                        <option value="aggressive">적극 압축</option>
                      </select>
                    </div>
                  </CardContent>
                </Card>

                <Card className="gap-0 py-0 shadow-none lg:col-span-2">
                  <CardHeader className="border-b border-border/60 pb-3 pt-4">
                    <CardTitle className="text-sm">참조 가능한 저장소 · 문서 범위</CardTitle>
                    <CardDescription className="text-xs">
                      허용 브랜치, 서브폴더, 위키 경로, 외부 문서 URL 패턴 등을 자유 형식으로
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4 pt-3">
                    <textarea
                      className={cn(inputBase, "min-h-[96px] resize-y font-mono text-xs")}
                      value={referenceScope}
                      onChange={(event) => setReferenceScope(event.target.value)}
                      placeholder={"예:\nrepo:acme/app (branch: main, path: /packages/ui)\ndocs:https://wiki.internal/team-x/*"}
                    />
                  </CardContent>
                </Card>

                <Card className="gap-0 py-0 shadow-none lg:col-span-2">
                  <CardHeader className="border-b border-border/60 pb-3 pt-4">
                    <CardTitle className="text-sm">비용 상한</CardTitle>
                    <CardDescription className="text-xs">
                      월별 상한(USD 정수). 비워 두면 미설정. 저장 시 센트 단위로 메타데이터에 기록됩니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4 pt-3">
                    <div className="flex max-w-xs items-center gap-2">
                      <span className="text-sm text-muted-foreground">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className={cn(inputBase, "h-9")}
                        value={costCapUsd}
                        onChange={(event) => setCostCapUsd(event.target.value)}
                        placeholder="0 = 없음"
                      />
                      <span className="text-xs text-muted-foreground">/ month</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-end border-t border-border/60 pt-3">
                <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                  <Rocket className="mr-1.5 h-3.5 w-3.5" />
                  팀 설정 저장
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
