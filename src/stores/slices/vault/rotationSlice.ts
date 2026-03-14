import type { StateCreator } from "zustand";
import type { VaultStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type {
  RotationStatus,
  RotationHistoryEntry,
  RotationPolicy,
  CreateRotationPolicyInput,
  UpdateRotationPolicyInput,
} from "@/api/vault/rotation";
import {
  getRotationStatus,
  getRotationHistory,
  createRotationPolicy,
  updateRotationPolicy,
  deleteRotationPolicy,
  rotateCredentialNow,
  refreshCredentialOAuthNow,
} from "@/api/vault/rotation";

export interface RotationSlice {
  // State
  rotationStatuses: Record<string, RotationStatus>;
  rotationOverviewList: RotationOverviewItem[];

  // Actions
  fetchRotationStatus: (credentialId: string) => Promise<RotationStatus | null>;
  fetchAllRotationStatuses: () => Promise<void>;
  createRotationPolicy: (input: CreateRotationPolicyInput) => Promise<RotationPolicy | null>;
  updateRotationPolicy: (id: string, input: UpdateRotationPolicyInput) => Promise<RotationPolicy | null>;
  deleteRotationPolicy: (id: string) => Promise<boolean>;
  rotateCredentialNow: (credentialId: string) => Promise<string | null>;
  refreshOAuthNow: (credentialId: string) => Promise<string | null>;
  fetchRotationHistory: (credentialId: string, limit?: number) => Promise<RotationHistoryEntry[]>;
}

export interface RotationOverviewItem {
  credentialId: string;
  credentialName: string;
  serviceType: string;
  status: RotationStatus;
}

function deriveOverviewList(
  statuses: Record<string, RotationStatus>,
  credentials: { id: string; name: string; service_type: string }[],
): RotationOverviewItem[] {
  const items: RotationOverviewItem[] = [];
  for (const cred of credentials) {
    const status = statuses[cred.id];
    if (!status) continue;
    if (!status.has_policy && !status.anomaly_detected) continue;
    items.push({
      credentialId: cred.id,
      credentialName: cred.name,
      serviceType: cred.service_type,
      status,
    });
  }
  // Sort: anomalies first, then by next_rotation_at ascending
  items.sort((a, b) => {
    if (a.status.anomaly_detected !== b.status.anomaly_detected) {
      return a.status.anomaly_detected ? -1 : 1;
    }
    const aNext = a.status.next_rotation_at ?? "9999";
    const bNext = b.status.next_rotation_at ?? "9999";
    return aNext.localeCompare(bNext);
  });
  return items;
}

export const createRotationSlice: StateCreator<VaultStore, [], [], RotationSlice> = (set, get) => ({
  rotationStatuses: {},
  rotationOverviewList: [],

  fetchRotationStatus: async (credentialId) => {
    try {
      const status = await getRotationStatus(credentialId);
      set((state) => {
        const rotationStatuses = { ...state.rotationStatuses, [credentialId]: status };
        return {
          rotationStatuses,
          rotationOverviewList: deriveOverviewList(rotationStatuses, state.credentials),
        };
      });
      return status;
    } catch (err) {
      reportError(err, "Failed to fetch rotation status", set);
      return null;
    }
  },

  fetchAllRotationStatuses: async () => {
    const credentials = get().credentials;
    if (credentials.length === 0) return;

    const statuses: Record<string, RotationStatus> = {};
    const results = await Promise.allSettled(
      credentials.map(async (cred) => {
        const status = await getRotationStatus(cred.id);
        return { id: cred.id, status };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        statuses[result.value.id] = result.value.status;
      }
    }

    set((state) => ({
      rotationStatuses: { ...state.rotationStatuses, ...statuses },
      rotationOverviewList: deriveOverviewList(
        { ...state.rotationStatuses, ...statuses },
        state.credentials,
      ),
    }));
  },

  createRotationPolicy: async (input) => {
    try {
      const policy = await createRotationPolicy(input);
      // Refresh status for this credential
      get().fetchRotationStatus(input.credential_id);
      return policy;
    } catch (err) {
      reportError(err, "Failed to create rotation policy", set);
      return null;
    }
  },

  updateRotationPolicy: async (id, input) => {
    try {
      const policy = await updateRotationPolicy(id, input);
      // Refresh all statuses since we don't know which credential this policy belongs to
      get().fetchAllRotationStatuses();
      return policy;
    } catch (err) {
      reportError(err, "Failed to update rotation policy", set);
      return null;
    }
  },

  deleteRotationPolicy: async (id) => {
    try {
      const result = await deleteRotationPolicy(id);
      get().fetchAllRotationStatuses();
      return result;
    } catch (err) {
      reportError(err, "Failed to delete rotation policy", set);
      return false;
    }
  },

  rotateCredentialNow: async (credentialId) => {
    try {
      const result = await rotateCredentialNow(credentialId);
      get().fetchRotationStatus(credentialId);
      return result;
    } catch (err) {
      reportError(err, "Failed to rotate credential", set);
      return null;
    }
  },

  refreshOAuthNow: async (credentialId) => {
    try {
      const result = await refreshCredentialOAuthNow(credentialId);
      get().fetchRotationStatus(credentialId);
      return result;
    } catch (err) {
      reportError(err, "Failed to refresh OAuth token", set);
      return null;
    }
  },

  fetchRotationHistory: async (credentialId, limit) => {
    try {
      return await getRotationHistory(credentialId, limit);
    } catch (err) {
      reportError(err, "Failed to fetch rotation history", set);
      return [];
    }
  },
});
