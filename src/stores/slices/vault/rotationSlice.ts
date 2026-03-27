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

  // Actions
  fetchRotationStatus: (credentialId: string) => Promise<RotationStatus | null>;
  fetchAllRotationStatuses: () => Promise<void>;
  createRotationPolicy: (input: CreateRotationPolicyInput) => Promise<RotationPolicy | null>;
  updateRotationPolicy: (id: string, input: UpdateRotationPolicyInput) => Promise<RotationPolicy | null>;
  deleteRotationPolicy: (id: string) => Promise<string | null>;
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

export const createRotationSlice: StateCreator<VaultStore, [], [], RotationSlice> = (set, get) => ({
  rotationStatuses: {},

  fetchRotationStatus: async (credentialId) => {
    try {
      const status = await getRotationStatus(credentialId);
      set((state) => ({
        rotationStatuses: { ...state.rotationStatuses, [credentialId]: status },
      }));
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
      get().fetchRotationStatus(policy.credential_id);
      return policy;
    } catch (err) {
      reportError(err, "Failed to update rotation policy", set);
      return null;
    }
  },

  deleteRotationPolicy: async (id) => {
    try {
      const credentialId = await deleteRotationPolicy(id);
      get().fetchRotationStatus(credentialId);
      return credentialId;
    } catch (err) {
      reportError(err, "Failed to delete rotation policy", set);
      return null;
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
