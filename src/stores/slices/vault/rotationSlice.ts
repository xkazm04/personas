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
  getAllRotationStatuses,
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

    // Skip when every credential's status is already cached this session.
    // Without this guard, every mount of RotationOverviewPanel re-fetched
    // statuses that hadn't changed (the 2026-05-17 perf-walk observed 25
    // get_rotation_status calls on every Overview landing). Callers that need
    // freshness should clear `rotationStatuses` or use `fetchRotationStatus`
    // for the specific credential.
    const cached = get().rotationStatuses;
    const allCached = credentials.every((c) => cached[c.id]);
    if (allCached) return;

    // Single batched IPC instead of N per-credential round-trips. The
    // 2026-05-25 profiling pass measured 27 get_rotation_status calls
    // (~2-3s of cumulative IPC + privileged-auth overhead) on startup; the
    // backend now computes every credential's status in one command.
    try {
      const statuses = await getAllRotationStatuses();
      set((state) => ({
        rotationStatuses: { ...state.rotationStatuses, ...statuses },
      }));
    } catch (err) {
      reportError(err, "Failed to fetch rotation statuses", set);
    }
  },

  createRotationPolicy: async (input) => {
    try {
      const policy = await createRotationPolicy(input);
      // Refresh status for this credential
      await get().fetchRotationStatus(input.credential_id);
      return policy;
    } catch (err) {
      reportError(err, "Failed to create rotation policy", set);
      return null;
    }
  },

  updateRotationPolicy: async (id, input) => {
    try {
      const policy = await updateRotationPolicy(id, input);
      await get().fetchRotationStatus(policy.credential_id);
      return policy;
    } catch (err) {
      reportError(err, "Failed to update rotation policy", set);
      return null;
    }
  },

  deleteRotationPolicy: async (id) => {
    try {
      const credentialId = await deleteRotationPolicy(id);
      await get().fetchRotationStatus(credentialId);
      return credentialId;
    } catch (err) {
      reportError(err, "Failed to delete rotation policy", set);
      return null;
    }
  },

  rotateCredentialNow: async (credentialId) => {
    try {
      const result = await rotateCredentialNow(credentialId);
      await get().fetchRotationStatus(credentialId);
      return result;
    } catch (err) {
      reportError(err, "Failed to rotate credential", set);
      return null;
    }
  },

  refreshOAuthNow: async (credentialId) => {
    try {
      const result = await refreshCredentialOAuthNow(credentialId);
      await get().fetchRotationStatus(credentialId);
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
