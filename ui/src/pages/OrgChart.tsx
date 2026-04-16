import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Link, useNavigate } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, type OrgNode } from "../api/agents";
import { organizationsApi } from "../api/organizations";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import { Check, Download, Network, Plus, Upload, X } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";
import { useToast } from "../context/ToastContext";

// Layout constants
const CARD_W = 200;
const CARD_H = 100;
const GAP_X = 32;
const GAP_Y = 80;
const PADDING = 60;

// ── Tree layout types ───────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  name: string;
  role: string;
  status: string;
  x: number;
  y: number;
  children: LayoutNode[];
  organizationId?: string | null;
  organizationName?: string | null;
}

// ── Org group bounding box ──────────────────────────────────────────────

interface OrgGroupBounds {
  organizationId: string;
  organizationName: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Layout algorithm ────────────────────────────────────────────────────

/** Compute the width each subtree needs. */
function subtreeWidth(node: OrgNode): number {
  if (node.reports.length === 0) return CARD_W;
  const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
  const gaps = (node.reports.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

/** Recursively assign x,y positions. */
function layoutTree(node: OrgNode, x: number, y: number): LayoutNode {
  const totalW = subtreeWidth(node);
  const layoutChildren: LayoutNode[] = [];

  if (node.reports.length > 0) {
    const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
    const gaps = (node.reports.length - 1) * GAP_X;
    let cx = x + (totalW - childrenW - gaps) / 2;

    for (const child of node.reports) {
      const cw = subtreeWidth(child);
      layoutChildren.push(layoutTree(child, cx, y + CARD_H + GAP_Y));
      cx += cw + GAP_X;
    }
  }

  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    x: x + (totalW - CARD_W) / 2,
    y,
    children: layoutChildren,
    organizationId: node.organizationId,
    organizationName: node.organizationName,
  };
}

/** Layout all root nodes side by side. */
function layoutForest(roots: OrgNode[]): LayoutNode[] {
  if (roots.length === 0) return [];

  const totalW = roots.reduce((sum, r) => sum + subtreeWidth(r), 0);
  const gaps = (roots.length - 1) * GAP_X;
  let x = PADDING;
  const y = PADDING;

  const result: LayoutNode[] = [];
  for (const root of roots) {
    const w = subtreeWidth(root);
    result.push(layoutTree(root, x, y));
    x += w + GAP_X;
  }

  // Compute bounds and return
  return result;
}

/** Compute bounding boxes for each org group. */
function computeOrgGroups(nodes: LayoutNode[]): OrgGroupBounds[] {
  const PAD = 12;
  const LABEL_H = 16;
  const groupMap = new Map<string, { name: string; minX: number; minY: number; maxX: number; maxY: number }>();

  for (const node of nodes) {
    if (!node.organizationId || !node.organizationName) continue;
    const existing = groupMap.get(node.organizationId);
    if (existing) {
      existing.minX = Math.min(existing.minX, node.x);
      existing.minY = Math.min(existing.minY, node.y);
      existing.maxX = Math.max(existing.maxX, node.x + CARD_W);
      existing.maxY = Math.max(existing.maxY, node.y + CARD_H);
    } else {
      groupMap.set(node.organizationId, {
        name: node.organizationName,
        minX: node.x,
        minY: node.y,
        maxX: node.x + CARD_W,
        maxY: node.y + CARD_H,
      });
    }
  }

  const result: OrgGroupBounds[] = [];
  for (const [id, g] of groupMap) {
    result.push({
      organizationId: id,
      organizationName: g.name,
      x: g.minX - PAD,
      y: g.minY - PAD - LABEL_H,
      width: g.maxX - g.minX + PAD * 2,
      height: g.maxY - g.minY + PAD * 2 + LABEL_H,
    });
  }
  return result;
}

function computeTeamGroups(nodes: LayoutNode[]): OrgGroupBounds[] {
  const PAD = 12;
  const LABEL_H = 16;
  const groups: OrgGroupBounds[] = [];
  for (const node of nodes) {
    if (node.children.length === 0) continue;
    const children = node.children;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = 0;
    let maxY = 0;
    for (const child of children) {
      minX = Math.min(minX, child.x);
      minY = Math.min(minY, child.y);
      maxX = Math.max(maxX, child.x + CARD_W);
      maxY = Math.max(maxY, child.y + CARD_H);
    }
    groups.push({
      organizationId: `team:${node.id}`,
      organizationName: `${node.name} Team`,
      x: minX - PAD,
      y: minY - PAD - LABEL_H,
      width: maxX - minX + PAD * 2,
      height: maxY - minY + PAD * 2 + LABEL_H,
    });
  }
  return groups;
}

/** Flatten layout tree to list of nodes. */
function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function walk(n: LayoutNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/** Collect all parent→child edges. */
function collectEdges(nodes: LayoutNode[]): Array<{ parent: LayoutNode; child: LayoutNode }> {
  const edges: Array<{ parent: LayoutNode; child: LayoutNode }> = [];
  function walk(n: LayoutNode) {
    for (const c of n.children) {
      edges.push({ parent: n, child: c });
      walk(c);
    }
  }
  nodes.forEach(walk);
  return edges;
}

// ── Status dot colors (raw hex for SVG) ─────────────────────────────────

const adapterLabels: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  gemini_local: "Gemini",
  opencode_local: "OpenCode",
  cursor: "Cursor",
  hermes_local: "Hermes",
  openclaw_gateway: "OpenClaw Gateway",
  process: "Process",
  http: "HTTP",
};

const statusDotColor: Record<string, string> = {
  running: "#22d3ee",
  active: "#4ade80",
  paused: "#facc15",
  idle: "#facc15",
  error: "#f87171",
  terminated: "#a3a3a3",
};
const defaultDotColor = "#a3a3a3";

// ── Main component ──────────────────────────────────────────────────────

export function OrgChart() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: orgTree, isLoading } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents ?? []) m.set(a.id, a);
    return m;
  }, [agents]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Org Chart" }]);
  }, [setBreadcrumbs]);

  // Layout computation
  const layout = useMemo(() => layoutForest(orgTree ?? []), [orgTree]);
  const allNodes = useMemo(() => flattenLayout(layout), [layout]);
  const edges = useMemo(() => collectEdges(layout), [layout]);
  const teamGroups = useMemo(() => computeTeamGroups(allNodes), [allNodes]);
  const orgGroups = useMemo(() => computeOrgGroups(allNodes), [allNodes]);

  const descendantsByAgent = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const walk = (node: OrgNode): Set<string> => {
      const descendants = new Set<string>();
      for (const child of node.reports) {
        descendants.add(child.id);
        for (const nested of walk(child)) descendants.add(nested);
      }
      map.set(node.id, descendants);
      return descendants;
    };
    for (const root of orgTree ?? []) walk(root);
    return map;
  }, [orgTree]);

  // Compute SVG bounds
  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { width: 800, height: 600 };
    let maxX = 0, maxY = 0;
    for (const n of allNodes) {
      maxX = Math.max(maxX, n.x + CARD_W);
      maxY = Math.max(maxY, n.y + CARD_H);
    }
    return { width: maxX + PADDING, height: maxY + PADDING };
  }, [allNodes]);

  // Pan & zoom state
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [dragAgentId, setDragAgentId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropOrgId, setDropOrgId] = useState<string | null>(null);
  const [showNewTeamForm, setShowNewTeamForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  const moveMutation = useMutation({
    mutationFn: async ({ agentId, reportsTo }: { agentId: string; reportsTo: string | null }) => {
      if (!selectedCompanyId) return;
      await agentsApi.update(agentId, { reportsTo }, selectedCompanyId);
    },
    onSuccess: async () => {
      if (!selectedCompanyId) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.org(selectedCompanyId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
      pushToast({ tone: "success", title: "Org moved" });
    },
    onError: (error) => {
      pushToast({
        tone: "error",
        title: "Failed to move agent",
        body: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  const { data: orgs } = useQuery({
    queryKey: queryKeys.organizations(selectedCompanyId!),
    queryFn: () => organizationsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    retry: false,
  });

  const assignOrgMutation = useMutation({
    mutationFn: async ({ agentId, orgId }: { agentId: string; orgId: string }) => {
      if (!selectedCompanyId) return;
      await organizationsApi.addMember(selectedCompanyId, orgId, agentId);
    },
    onSuccess: async () => {
      if (!selectedCompanyId) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.org(selectedCompanyId) });
      pushToast({ tone: "success", title: "Agent assigned to team" });
    },
    onError: (error) => {
      pushToast({
        tone: "error",
        title: "Failed to assign agent",
        body: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  const createTeamMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!selectedCompanyId) return;
      await organizationsApi.create(selectedCompanyId, { name, level: "team" });
    },
    onSuccess: async () => {
      if (!selectedCompanyId) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.organizations(selectedCompanyId) });
      setShowNewTeamForm(false);
      setNewTeamName("");
      pushToast({ tone: "success", title: "Team created" });
    },
    onError: (error) => {
      pushToast({
        tone: "error",
        title: "Failed to create team",
        body: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  // Center the chart on first load
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current || allNodes.length === 0 || !containerRef.current) return;
    hasInitialized.current = true;

    const container = containerRef.current;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;

    // Fit chart to container
    const scaleX = (containerW - 40) / bounds.width;
    const scaleY = (containerH - 40) / bounds.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);

    const chartW = bounds.width * fitZoom;
    const chartH = bounds.height * fitZoom;

    setZoom(fitZoom);
    setPan({
      x: (containerW - chartW) / 2,
      y: (containerH - chartH) / 2,
    });
  }, [allNodes, bounds]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't drag if clicking a card
    const target = e.target as HTMLElement;
    if (target.closest("[data-org-card]")) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(Math.max(zoom * factor, 0.2), 2);

    // Zoom toward mouse position
    const scale = newZoom / zoom;
    setPan({
      x: mouseX - scale * (mouseX - pan.x),
      y: mouseY - scale * (mouseY - pan.y),
    });
    setZoom(newZoom);
  }, [zoom, pan]);

  const canDrop = useCallback((agentId: string, targetId: string | null) => {
    if (agentId === targetId) return false;
    if (targetId && descendantsByAgent.get(agentId)?.has(targetId)) return false;
    return true;
  }, [descendantsByAgent]);

  const handleAgentDrop = useCallback((targetId: string | null) => {
    if (!dragAgentId || !canDrop(dragAgentId, targetId)) {
      setDropTargetId(null);
      setDragAgentId(null);
      return;
    }
    const current = agentMap.get(dragAgentId);
    if (current && (current.reportsTo ?? null) === targetId) {
      setDropTargetId(null);
      setDragAgentId(null);
      return;
    }
    moveMutation.mutate({ agentId: dragAgentId, reportsTo: targetId });
    setDropTargetId(null);
    setDragAgentId(null);
  }, [agentMap, canDrop, dragAgentId, moveMutation]);

  const handleOrgDrop = useCallback((orgId: string) => {
    if (!dragAgentId) return;
    assignOrgMutation.mutate({ agentId: dragAgentId, orgId });
    setDropOrgId(null);
    setDragAgentId(null);
  }, [assignOrgMutation, dragAgentId]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Network} message="Select a company to view the org chart." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="org-chart" />;
  }

  if (orgTree && orgTree.length === 0) {
    return <EmptyState icon={Network} message="No organizational hierarchy defined." />;
  }

  return (
    <div className="flex flex-col h-full">
    <div className="mb-2 flex items-center justify-start gap-2 shrink-0 flex-wrap">
      <Link to="/company/import">
        <Button variant="outline" size="sm">
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Import company
        </Button>
      </Link>
      <Link to="/company/export">
        <Button variant="outline" size="sm">
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export company
        </Button>
      </Link>
      {orgs !== undefined && (
        showNewTeamForm ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (newTeamName.trim()) createTeamMutation.mutate(newTeamName.trim());
            }}
          >
            <input
              autoFocus
              aria-label="New team name"
              className="h-8 rounded-md border border-border bg-background px-2.5 text-sm outline-none ring-offset-background focus:ring-1 focus:ring-ring"
              placeholder="Team name…"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setShowNewTeamForm(false); setNewTeamName(""); } }}
            />
            <Button type="submit" size="sm" disabled={!newTeamName.trim() || createTeamMutation.isPending} aria-label="Save team">
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setShowNewTeamForm(false); setNewTeamName(""); }} aria-label="Cancel">
              <X className="h-3.5 w-3.5" />
            </Button>
          </form>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setShowNewTeamForm(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Team
          </Button>
        )
      )}
    </div>
    <div
      ref={containerRef}
      className="w-full flex-1 min-h-0 overflow-hidden relative bg-muted/20 border border-border rounded-lg"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
          onClick={() => {
            const newZoom = Math.min(zoom * 1.2, 2);
            const container = containerRef.current;
            if (container) {
              const cx = container.clientWidth / 2;
              const cy = container.clientHeight / 2;
              const scale = newZoom / zoom;
              setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
            }
            setZoom(newZoom);
          }}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
          onClick={() => {
            const newZoom = Math.max(zoom * 0.8, 0.2);
            const container = containerRef.current;
            if (container) {
              const cx = container.clientWidth / 2;
              const cy = container.clientHeight / 2;
              const scale = newZoom / zoom;
              setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
            }
            setZoom(newZoom);
          }}
          aria-label="Zoom out"
        >
          &minus;
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-[10px] hover:bg-accent transition-colors"
          onClick={() => {
            if (!containerRef.current) return;
            const cW = containerRef.current.clientWidth;
            const cH = containerRef.current.clientHeight;
            const scaleX = (cW - 40) / bounds.width;
            const scaleY = (cH - 40) / bounds.height;
            const fitZoom = Math.min(scaleX, scaleY, 1);
            const chartW = bounds.width * fitZoom;
            const chartH = bounds.height * fitZoom;
            setZoom(fitZoom);
            setPan({ x: (cW - chartW) / 2, y: (cH - chartH) / 2 });
          }}
          title="Fit to screen"
          aria-label="Fit chart to screen"
        >
          Fit
        </button>
      </div>

      {/* SVG layer for org group bounding boxes + edges */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{
          width: "100%",
          height: "100%",
        }}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Org department/team bounding boxes */}
          {teamGroups.map((group) => (
            <g key={group.organizationId}>
              <rect
                x={group.x}
                y={group.y}
                width={group.width}
                height={group.height}
                rx={8}
                ry={8}
                fill="#0ea5e9"
                fillOpacity={0.06}
                stroke="#0ea5e9"
                strokeWidth={1}
                strokeDasharray="5 3"
              />
              <text
                x={group.x + 8}
                y={group.y + 12}
                fontSize={10}
                fontWeight={600}
                fill="#0284c7"
                fontFamily="inherit"
                opacity={0.9}
              >
                {group.organizationName}
              </text>
            </g>
          ))}
          {orgGroups.map((group) => (
            <g key={group.organizationId}>
              <rect
                x={group.x}
                y={group.y}
                width={group.width}
                height={group.height}
                rx={8}
                ry={8}
                fill="var(--accent)"
                fillOpacity={0.08}
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <text
                x={group.x + 8}
                y={group.y + 12}
                fontSize={10}
                fontWeight={600}
                fill="var(--muted-foreground)"
                fontFamily="inherit"
                opacity={0.7}
              >
                {group.organizationName}
              </text>
            </g>
          ))}
          {edges.map(({ parent, child }) => {
            const x1 = parent.x + CARD_W / 2;
            const y1 = parent.y + CARD_H;
            const x2 = child.x + CARD_W / 2;
            const y2 = child.y;
            const midY = (y1 + y2) / 2;

            return (
              <path
                key={`${parent.id}-${child.id}`}
                d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
                fill="none"
                stroke="var(--border)"
                strokeWidth={1.5}
              />
            );
          })}
        </g>
      </svg>

      {/* Org group drop overlay layer (HTML, above SVG) — only visible while dragging */}
      {dragAgentId && orgs && orgs.length > 0 && (
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            pointerEvents: "none",
          }}
        >
          {orgGroups.map((group) => {
            const org = orgs.find((o) => o.id === group.organizationId);
            if (!org) return null;
            const isOver = dropOrgId === group.organizationId;
            return (
              <div
                key={group.organizationId}
                role="button"
                aria-label={`Assign to ${group.organizationName}`}
                style={{
                  position: "absolute",
                  left: group.x,
                  top: group.y,
                  width: group.width,
                  height: group.height,
                  pointerEvents: "all",
                  borderRadius: 8,
                  border: isOver ? "2px solid var(--primary)" : "2px solid transparent",
                  background: isOver ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "transparent",
                  transition: "border-color 100ms, background 100ms",
                  cursor: "copy",
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  setDropOrgId(group.organizationId);
                }}
                onDragLeave={() => {
                  if (dropOrgId === group.organizationId) setDropOrgId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleOrgDrop(group.organizationId);
                }}
              />
            );
          })}
        </div>
      )}

      {/* Card layer */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {allNodes.map((node) => {
          const agent = agentMap.get(node.id);
          const dotColor = statusDotColor[node.status] ?? defaultDotColor;

          return (
            <div
              key={node.id}
              data-org-card
              tabIndex={0}
              role="button"
              aria-label={`${node.name}, ${agent?.title ?? roleLabel(node.role)}`}
              className={`absolute bg-card border rounded-lg shadow-sm hover:shadow-md transition-[box-shadow,border-color] duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                dropTargetId === node.id ? "border-primary ring-1 ring-primary/50" : "border-border hover:border-foreground/20"
              }`}
              style={{
                left: node.x,
                top: node.y,
                width: CARD_W,
                minHeight: CARD_H,
              }}
              draggable
              onDragStart={(event) => {
                setDragAgentId(node.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", node.id);
              }}
              onDragEnd={() => {
                setDragAgentId(null);
                setDropTargetId(null);
                setDropOrgId(null);
              }}
              onDragOver={(event) => {
                if (!dragAgentId || !canDrop(dragAgentId, node.id)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetId(node.id);
              }}
              onDragLeave={() => {
                if (dropTargetId === node.id) setDropTargetId(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleAgentDrop(node.id);
              }}
              onClick={() => navigate(agent ? agentUrl(agent) : `/agents/${node.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(agent ? agentUrl(agent) : `/agents/${node.id}`);
                }
              }}
            >
              <div className="flex items-center px-4 py-3 gap-3">
                {/* Agent icon + status dot */}
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                    <AgentIcon icon={agent?.icon} className="h-4.5 w-4.5 text-foreground/70" />
                  </div>
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card"
                    style={{ backgroundColor: dotColor }}
                  />
                </div>
                {/* Name + role + adapter type */}
                <div className="flex flex-col items-start min-w-0 flex-1">
                  <span className="text-sm font-semibold text-foreground leading-tight">
                    {node.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                    {agent?.title ?? roleLabel(node.role)}
                  </span>
                  {agent && (
                    <span className="text-[10px] text-muted-foreground/60 font-mono leading-tight mt-1">
                      {adapterLabels[agent.adapterType] ?? agent.adapterType}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1">
        <button
          type="button"
          aria-label="Move dragged agent to top level"
          className={`rounded-md border px-2 py-1 text-xs bg-background/95 ${
            dropTargetId === "__root__" ? "border-primary text-primary" : "border-border text-muted-foreground"
          }`}
          onDragOver={(event) => {
            if (!dragAgentId || !canDrop(dragAgentId, null)) return;
            event.preventDefault();
            setDropTargetId("__root__");
          }}
          onDragLeave={() => {
            if (dropTargetId === "__root__") setDropTargetId(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            handleAgentDrop(null);
          }}
          title="Drop an agent here to move to top-level"
        >
          Drop Here: Move to Top Level
        </button>
        {dragAgentId && orgs && orgs.length > 0 && (
          <div className="text-[10px] text-muted-foreground bg-background/95 border border-border rounded px-2 py-1">
            Drag onto a team box to assign
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

const roleLabels: Record<string, string> = AGENT_ROLE_LABELS;

function roleLabel(role: string): string {
  return roleLabels[role] ?? role;
}
