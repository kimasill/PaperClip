import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi, type OrgNode } from "../api/agents";
import { organizationsApi, type Organization } from "../api/organizations";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { ChevronRight, GitBranch, Plus, Pencil, Trash2, Users, Building2, X, Check } from "lucide-react";
import { cn } from "../lib/utils";

// ── Org tree (read-only hierarchy view) ────────────────────────────────

function OrgTree({
  nodes,
  depth = 0,
  hrefFn,
}: {
  nodes: OrgNode[];
  depth?: number;
  hrefFn: (id: string) => string;
}) {
  return (
    <div>
      {nodes.map((node) => (
        <OrgTreeNode key={node.id} node={node} depth={depth} hrefFn={hrefFn} />
      ))}
    </div>
  );
}

function OrgTreeNode({
  node,
  depth,
  hrefFn,
}: {
  node: OrgNode;
  depth: number;
  hrefFn: (id: string) => string;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.reports.length > 0;

  return (
    <div>
      <Link
        to={hrefFn(node.id)}
        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer hover:bg-accent/50 no-underline text-inherit"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        {hasChildren ? (
          <button
            className="p-0.5"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            <ChevronRight
              className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            node.status === "active"
              ? "bg-green-400"
              : node.status === "paused"
                ? "bg-yellow-400"
                : node.status === "pending_approval"
                  ? "bg-amber-400"
                : node.status === "error"
                  ? "bg-red-400"
                  : "bg-neutral-400"
          )}
        />
        <span className="font-medium flex-1">{node.name}</span>
        <span className="text-xs text-muted-foreground">{node.role}</span>
        <StatusBadge status={node.status} />
      </Link>
      {hasChildren && expanded && (
        <OrgTree nodes={node.reports} depth={depth + 1} hrefFn={hrefFn} />
      )}
    </div>
  );
}

// ── Org management CRUD ─────────────────────────────────────────────────

interface OrgRowProps {
  org: Organization;
  onEdit: (org: Organization) => void;
  onDelete: (org: Organization) => void;
}

function OrgRow({ org, onEdit, onDelete }: OrgRowProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-border/60 bg-card hover:bg-accent/20 transition-colors">
      <span className={cn(
        "inline-flex items-center justify-center h-6 w-6 rounded text-[10px] font-bold shrink-0",
        org.level === "department"
          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
          : "bg-purple-500/10 text-purple-600 dark:text-purple-400",
      )}>
        {org.level === "department" ? <Building2 className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
      </span>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm truncate">{org.name}</span>
        <span className="ml-2 text-xs text-muted-foreground capitalize">{org.level}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground h-6 w-6"
          onClick={() => onEdit(org)}
          title="Edit"
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-destructive h-6 w-6"
          onClick={() => onDelete(org)}
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

interface OrgFormProps {
  initial?: { name: string; level: "department" | "team" };
  onSubmit: (data: { name: string; level: "department" | "team" }) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function OrgForm({ initial, onSubmit, onCancel, isLoading }: OrgFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [level, setLevel] = useState<"department" | "team">(initial?.level ?? "department");

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-accent/10">
      <input
        autoFocus
        className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-border/60 pb-0.5 placeholder:text-muted-foreground/50"
        placeholder="Name..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) onSubmit({ name: name.trim(), level });
          if (e.key === "Escape") onCancel();
        }}
      />
      <select
        className="text-xs bg-transparent border border-border rounded px-1.5 py-0.5 outline-none"
        value={level}
        onChange={(e) => setLevel(e.target.value as "department" | "team")}
      >
        <option value="department">Department</option>
        <option value="team">Team</option>
      </select>
      <Button
        size="icon-xs"
        variant="ghost"
        className="h-6 w-6 text-green-600"
        disabled={!name.trim() || isLoading}
        onClick={() => { if (name.trim()) onSubmit({ name: name.trim(), level }); }}
        title="Save"
      >
        <Check className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        className="h-6 w-6 text-muted-foreground"
        onClick={onCancel}
        title="Cancel"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function OrgManagement({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [deletingOrgId, setDeletingOrgId] = useState<string | null>(null);

  const { data: orgs, isLoading, error } = useQuery({
    queryKey: queryKeys.organizations(companyId),
    queryFn: () => organizationsApi.list(companyId),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; level: "department" | "team" }) =>
      organizationsApi.create(companyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations(companyId) });
      setShowNewForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string } }) =>
      organizationsApi.update(companyId, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations(companyId) });
      setEditingOrg(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (orgId: string) => organizationsApi.delete(companyId, orgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations(companyId) });
      setDeletingOrgId(null);
    },
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground py-4 text-center">Loading departments...</div>;
  }

  // If the API endpoint doesn't exist yet, show a coming-soon notice
  if (error) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center space-y-2">
        <Building2 className="h-8 w-8 mx-auto text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Department & team management will be available once the backend organization schema is deployed.
        </p>
        <p className="text-xs text-muted-foreground/60">
          Phase 1 (DB schema) must be completed first.
        </p>
      </div>
    );
  }

  const departments = (orgs ?? []).filter((o) => o.level === "department");
  const teams = (orgs ?? []).filter((o) => o.level === "team");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Departments & Teams</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { setShowNewForm(true); setEditingOrg(null); }}
          disabled={showNewForm}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New
        </Button>
      </div>

      {showNewForm && (
        <OrgForm
          onSubmit={(data) => createMutation.mutate(data)}
          onCancel={() => setShowNewForm(false)}
          isLoading={createMutation.isPending}
        />
      )}

      {(orgs ?? []).length === 0 && !showNewForm && (
        <div className="rounded-md border border-dashed border-border p-4 text-center">
          <p className="text-sm text-muted-foreground">No departments or teams yet. Create one to organize agents.</p>
        </div>
      )}

      {departments.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Departments</div>
          {departments.map((org) => (
            editingOrg?.id === org.id ? (
              <OrgForm
                key={org.id}
                initial={{ name: org.name, level: org.level }}
                onSubmit={(data) => updateMutation.mutate({ id: org.id, data: { name: data.name } })}
                onCancel={() => setEditingOrg(null)}
                isLoading={updateMutation.isPending}
              />
            ) : deletingOrgId === org.id ? (
              <div key={org.id} className="flex items-center gap-3 px-3 py-2 rounded-md border border-destructive/40 bg-destructive/5 text-sm">
                <span className="flex-1 text-destructive">Delete &ldquo;{org.name}&rdquo;?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 text-xs px-2"
                  onClick={() => deleteMutation.mutate(org.id)}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs px-2"
                  onClick={() => setDeletingOrgId(null)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <OrgRow
                key={org.id}
                org={org}
                onEdit={setEditingOrg}
                onDelete={(o) => setDeletingOrgId(o.id)}
              />
            )
          ))}
        </div>
      )}

      {teams.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Teams</div>
          {teams.map((org) => (
            editingOrg?.id === org.id ? (
              <OrgForm
                key={org.id}
                initial={{ name: org.name, level: org.level }}
                onSubmit={(data) => updateMutation.mutate({ id: org.id, data: { name: data.name } })}
                onCancel={() => setEditingOrg(null)}
                isLoading={updateMutation.isPending}
              />
            ) : deletingOrgId === org.id ? (
              <div key={org.id} className="flex items-center gap-3 px-3 py-2 rounded-md border border-destructive/40 bg-destructive/5 text-sm">
                <span className="flex-1 text-destructive">Delete &ldquo;{org.name}&rdquo;?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 text-xs px-2"
                  onClick={() => deleteMutation.mutate(org.id)}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs px-2"
                  onClick={() => setDeletingOrgId(null)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <OrgRow
                key={org.id}
                org={org}
                onEdit={setEditingOrg}
                onDelete={(o) => setDeletingOrgId(o.id)}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Org page ───────────────────────────────────────────────────────

export function Org() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState<"hierarchy" | "manage">("hierarchy");

  useEffect(() => {
    setBreadcrumbs([{ label: "Org Chart" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={GitBranch} message="Select a company to view org chart." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border pb-0">
        <button
          className={cn(
            "px-3 py-1.5 text-sm font-medium transition-colors border-b-2 -mb-px",
            activeTab === "hierarchy"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setActiveTab("hierarchy")}
        >
          Hierarchy
        </button>
        <button
          className={cn(
            "px-3 py-1.5 text-sm font-medium transition-colors border-b-2 -mb-px",
            activeTab === "manage"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setActiveTab("manage")}
        >
          Departments & Teams
        </button>
      </div>

      {activeTab === "hierarchy" && (
        <>
          {error && <p className="text-sm text-destructive">{error.message}</p>}

          {data && data.length === 0 && (
            <EmptyState
              icon={GitBranch}
              message="No agents in the organization. Create agents to build your org chart."
            />
          )}

          {data && data.length > 0 && (
            <div className="border border-border py-1">
              <OrgTree nodes={data} hrefFn={(id) => `/agents/${id}`} />
            </div>
          )}
        </>
      )}

      {activeTab === "manage" && (
        <OrgManagement companyId={selectedCompanyId} />
      )}
    </div>
  );
}
