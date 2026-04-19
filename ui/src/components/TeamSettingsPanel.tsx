import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Rocket, Users } from "lucide-react";
import { agentsApi, type OrgNode } from "../api/agents";
import { organizationsApi } from "../api/organizations";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { useToast } from "../context/ToastContext";
import { hasTeamEnabled, readTeamSettings, withTeamSettings } from "../lib/team-settings";
import { useSearchParams } from "@/lib/router";

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
  }, [teamSettings, selectedLeadId, selectedLead]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLead) return;
      const normalizedParallelization = Math.min(12, Math.max(1, Math.round(parallelization)));
      const teamMemberIds = applyToTeamAgents
        ? [selectedLead.id, ...(descendantsByLead.get(selectedLead.id) ?? [])]
        : [selectedLead.id];
      const uniqueTeamMemberIds = [...new Set(teamMemberIds)];

      const teamMetadata = withTeamSettings(selectedLead.metadata, {
        teamName: teamName.trim(),
        goal: goal.trim(),
        parallelization: normalizedParallelization,
        performanceProfile,
        conventions,
        prompt,
        enabled: true,
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
        teamName: existing.teamName || `${agent.name} Team`,
        goal: existing.goal,
        parallelization: existing.parallelization,
        performanceProfile: existing.performanceProfile,
        conventions: existing.conventions,
        prompt: existing.prompt,
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
      className="space-y-3 rounded-md border border-border px-4 py-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Teams</h3>
          <p className="text-xs text-muted-foreground">
            Configure team goals, parallelization, and performance defaults by team lead.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-8 min-w-[220px] rounded-md border border-border bg-transparent px-2 text-sm"
          value={newLeadId}
          onChange={(event) => setNewLeadId(event.target.value)}
        >
          <option value="">Enable team from agent...</option>
          {availableLeads.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
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
        <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          No teams yet. Enable a team from an agent or assign direct reports in Org Chart.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                  selectedLeadId === team.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setSelectedLeadId(team.id)}
              >
                <Users className="h-3.5 w-3.5" />
                <span>{team.name}</span>
                <span className="text-[10px] opacity-75">({directReportCounts.get(team.id) ?? 0})</span>
              </button>
            ))}
          </div>

          {selectedLead ? (
            <div className="space-y-2 rounded-md border border-border/70 p-3">
              <div className="text-xs text-muted-foreground">
                Team lead: <span className="font-medium text-foreground">{selectedLead.name}</span>
              </div>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>Team name</span>
                <input
                  className="h-8 w-full rounded-md border border-border bg-transparent px-2 text-sm outline-none"
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  placeholder={`${selectedLead.name} Team`}
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>Team goal</span>
                <textarea
                  className="min-h-[70px] w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  placeholder="Current quarter objective for this team..."
                />
              </label>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="space-y-1 text-xs text-muted-foreground">
                  <span>Parallelization level</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={12}
                      value={parallelization}
                      onChange={(event) => setParallelization(Number(event.target.value))}
                      className="w-full"
                    />
                    <span className="w-8 text-right text-xs text-foreground">{parallelization}</span>
                  </div>
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  <span>Performance profile</span>
                  <select
                    className="h-8 w-full rounded-md border border-border bg-transparent px-2 text-sm outline-none"
                    value={performanceProfile}
                    onChange={(event) =>
                      setPerformanceProfile(event.target.value as "balanced" | "speed" | "quality")
                    }
                  >
                    <option value="balanced">Balanced</option>
                    <option value="speed">Speed</option>
                    <option value="quality">Quality</option>
                  </select>
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border border-border bg-transparent"
                  checked={applyToTeamAgents}
                  onChange={(event) => setApplyToTeamAgents(event.target.checked)}
                />
                Apply parallelization and performance profile to team agents
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>Team conventions</span>
                <textarea
                  className="min-h-[90px] w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none"
                  value={conventions}
                  onChange={(event) => setConventions(event.target.value)}
                  placeholder="Coding conventions, review rules, delivery policy..."
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>Shared prompt</span>
                <textarea
                  className="min-h-[90px] w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Team-level prompt defaults..."
                />
              </label>
              <div className="flex justify-end">
                <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                  <Rocket className="mr-1.5 h-3.5 w-3.5" />
                  Save Team Settings
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
