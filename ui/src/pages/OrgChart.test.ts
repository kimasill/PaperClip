import { describe, expect, it } from "vitest";
import { computeTeamGroups, type LayoutNode } from "./OrgChart";

function makeNode(input: Partial<LayoutNode> & Pick<LayoutNode, "id" | "name" | "x" | "y">): LayoutNode {
  return {
    role: "engineer",
    status: "idle",
    children: [],
    ...input,
  };
}

describe("computeTeamGroups", () => {
  it("splits a manager's direct reports by organization", () => {
    const manager = makeNode({
      id: "manager-1",
      name: "Manager",
      x: 0,
      y: 0,
      children: [
        makeNode({ id: "a", name: "A", x: 100, y: 200, organizationId: "org-a", organizationName: "Alpha Team" }),
        makeNode({ id: "b", name: "B", x: 350, y: 200, organizationId: "org-b", organizationName: "Beta Team" }),
        makeNode({ id: "c", name: "C", x: 600, y: 200, organizationId: "org-b", organizationName: "Beta Team" }),
      ],
    });

    const groups = computeTeamGroups([manager]);
    const ids = groups.map((group) => group.organizationId).sort();

    expect(ids).toEqual(["org:org-a:lead:manager-1", "org:org-b:lead:manager-1"]);
    expect(groups.find((group) => group.organizationId === "org:org-a:lead:manager-1")?.organizationName).toBe(
      "Alpha Team",
    );
    expect(groups.find((group) => group.organizationId === "org:org-b:lead:manager-1")?.organizationName).toBe(
      "Beta Team",
    );
  });

  it("preserves legacy single-team grouping when reports have no org", () => {
    const manager = makeNode({
      id: "manager-2",
      name: "Legacy Manager",
      x: 0,
      y: 0,
      children: [
        makeNode({ id: "a", name: "A", x: 100, y: 200 }),
        makeNode({ id: "b", name: "B", x: 360, y: 200 }),
      ],
    });

    const groups = computeTeamGroups([manager]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.organizationId).toBe("team:manager-2");
    expect(groups[0]?.organizationName).toBe("Legacy Manager Team");
  });
});
