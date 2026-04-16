import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Save } from "lucide-react";
import { agentsApi, type OrgNode } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { useToast } from "../context/ToastContext";
import { hasTeamEnabled, readTeamSettings, withTeamSettings } from "../lib/team-settings";

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

export function TeamSettingsPanel({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

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

  const directReportCounts = useMemo(() => {
    const map = new Map<string, number>();
    collectDirectReportCounts(orgTree ?? [], map);
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
  const [conventions, setConventions] = useState("");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!selectedLeadId && teams.length > 0) {
      setSelectedLeadId(teams[0]!.id);
    } else if (selectedLeadId && !teams.some((team) => team.id === selectedLeadId)) {
      setSelectedLeadId(teams[0]?.id ?? "");
    }
  }, [teams, selectedLeadId]);

  useEffect(() => {
    setConventions(teamSettings.conventions);
    setPrompt(teamSettings.prompt);
  }, [teamSettings.conventions, teamSettings.prompt, selectedLeadId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLead) return;
      const metadata = withTeamSettings(selectedLead.metadata, {
        conventions,
        prompt,
        enabled: true,
      });
      await agentsApi.update(selectedLead.id, { metadata }, companyId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.org(companyId) });
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
      const metadata = withTeamSettings(agent.metadata, {
        ...readTeamSettings(agent.metadata),
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
    <div className="space-y-3 rounded-md border border-border px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Teams</h3>
          <p className="text-xs text-muted-foreground">
            Configure team conventions and shared prompt by team lead.
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
                  <Save className="mr-1.5 h-3.5 w-3.5" />
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
