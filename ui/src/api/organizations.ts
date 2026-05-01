import { api } from "./client";

export interface Organization {
  id: string;
  companyId: string;
  name: string;
  level: "department" | "team";
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  agentId: string;
  isManager: boolean;
}

export const organizationsApi = {
  list: (companyId: string) =>
    api.get<Organization[]>(`/companies/${companyId}/organizations`),

  create: (companyId: string, data: { name: string; level: "department" | "team"; parentId?: string | null }) =>
    api.post<Organization>(`/companies/${companyId}/organizations`, data),

  update: (companyId: string, orgId: string, data: { name?: string; parentId?: string | null }) =>
    api.patch<Organization>(`/companies/${companyId}/organizations/${orgId}`, data),

  delete: (companyId: string, orgId: string) =>
    api.delete<void>(`/companies/${companyId}/organizations/${orgId}`),

  listMembers: (companyId: string, orgId: string) =>
    api.get<OrganizationMember[]>(`/companies/${companyId}/organizations/${orgId}/members`),

  addMember: (companyId: string, orgId: string, agentId: string, isManager = false) =>
    api.post<void>(`/companies/${companyId}/organizations/${orgId}/members`, { agentId, isManager }),

  removeMember: (companyId: string, orgId: string, agentId: string) =>
    api.delete<void>(`/companies/${companyId}/organizations/${orgId}/members/${agentId}`),

  setManager: (companyId: string, orgId: string, agentId: string, isManager: boolean) =>
    api.patch<void>(`/companies/${companyId}/organizations/${orgId}/members/${agentId}`, { isManager }),
};
