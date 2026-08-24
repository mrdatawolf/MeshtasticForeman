import { request } from "./client.js";

import type { CoverageProposal } from "@foreman/shared";

export type CreateProposal = Pick<
  CoverageProposal,
  "name" | "lat" | "lon" | "altitudeM" | "modemPreset" | "notes"
>;
export type UpdateProposal = Partial<Omit<CoverageProposal, "id" | "createdAt">>;

export function listProposals(signal?: AbortSignal): Promise<CoverageProposal[] | undefined> {
  return request<CoverageProposal[]>("/api/proposals", { signal });
}

export function createProposal(
  proposal: CreateProposal,
  signal?: AbortSignal,
): Promise<CoverageProposal | undefined> {
  return request<CoverageProposal>("/api/proposals", { method: "POST", body: proposal, signal });
}

export function updateProposal(
  id: string,
  patch: UpdateProposal,
  signal?: AbortSignal,
): Promise<CoverageProposal | undefined> {
  return request<CoverageProposal>(`/api/proposals/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
    signal,
  });
}

export function deleteProposal(id: string, signal?: AbortSignal): Promise<void> {
  return request<void>(`/api/proposals/${encodeURIComponent(id)}`, { method: "DELETE", signal });
}
