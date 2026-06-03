import type { StateCreator } from "zustand";
import type { VaultStore } from "../../storeTypes";
import { errMsg, reportError } from "../../storeTypes";
import type {
  CredentialMetadata,
  ConnectorDefinition,
  CredentialEvent,
} from "@/lib/types/types";
import {
  toCredentialMetadata as toCredMeta,
  parseConnectorDefinition as parseConn,
} from "@/lib/types/types";
import { createConnector, deleteConnector, listConnectors } from "@/api/auth/connectors";
import { createCredential, createCredentialEvent, deleteCredential, deleteCredentialEvent, healthcheckCredential, healthcheckCredentialPreview, listAllCredentialEvents, listCredentials, updateCredential, updateCredentialEvent, updateCredentialField } from "@/api/vault/credentials";

import { encryptWithSessionKey } from "@/lib/utils/platform/crypto";
import { createCachedFetch } from "@/lib/async/createCachedFetch";

// fetchCredentials dedup + freshness via the shared createCachedFetch primitive
// (src/lib/async/createCachedFetch.ts). A persona-switch burst of 3-4 concurrent
// callers collapses to one IPC, and the 30s window skips redundant refetches.
// State of the world: 31 callsites under src/features/vault + a handful of
// outside-vault consumers (matrix, connectors, home cockpit) all reach for
// fetchCredentials on mount. Optimistic mutations update state directly, so
// the cache (which IS the slice state) stays consistent without an explicit
// bust path — the TTL window simply re-confirms against the backend. The one
// race the TTL can't paper over is delete vs. an already-in-flight fetch: that
// fetch's pre-delete snapshot would overwrite the optimistic removal wholesale
// and resurrect the just-deleted row (no longer greyed out, since it's left
// pendingDeleteCredentialIds). recentlyDeletedCredentialIds tombstones close
// that seam — see deleteCredential / fetchCredentials below.
const CREDENTIALS_CACHE_TTL_MS = 30_000;
const credentialsFetch = createCachedFetch({ ttlMs: CREDENTIALS_CACHE_TTL_MS, rethrow: true });

export interface CredentialSlice {
  // State
  credentials: CredentialMetadata[];
  credentialEvents: CredentialEvent[];
  connectorDefinitions: ConnectorDefinition[];
  pendingDeleteCredentialIds: Set<string>;
  pendingDeleteEventIds: Set<string>;
  /**
   * Short-lived tombstones for credentials removed via deleteCredential. A
   * fetchCredentials already in flight when the delete commits resolves with a
   * pre-delete snapshot that still lists the row; fetchCredentials filters any
   * tombstoned id out of that snapshot so the deleted credential can't flicker
   * back into the vault, and retires each tombstone once a fetch confirms the
   * backend no longer returns it (keeping the set bounded, not growing per
   * delete).
   */
  recentlyDeletedCredentialIds: Set<string>;

  // Actions
  fetchCredentials: () => Promise<void>;
  createCredential: (input: { name: string; service_type: string; data: object; healthcheck_passed?: boolean }) => Promise<string>;
  updateCredential: (id: string, input: { name?: string; service_type?: string; data?: object }) => Promise<void>;
  deleteCredential: (id: string) => Promise<void>;
  updateCredentialField: (id: string, key: string, value: string) => Promise<void>;
  healthcheckCredential: (credentialId: string) => Promise<{ success: boolean; message: string }>;
  healthcheckCredentialPreview: (serviceType: string, fieldValues: Record<string, string>) => Promise<{ success: boolean; message: string }>;
  fetchConnectorDefinitions: () => Promise<void>;
  createConnectorDefinition: (input: {
    name: string;
    label: string;
    category: string;
    color: string;
    fields: string;
    services: string;
    events: string;
    healthcheck_config?: string | null;
    metadata?: string | null;
    is_builtin?: boolean | null;
  }) => Promise<ConnectorDefinition>;
  deleteConnectorDefinition: (id: string) => Promise<void>;
  fetchCredentialEvents: () => Promise<void>;
  createCredentialEvent: (input: { credential_id: string; event_template_id: string; name: string; config?: object | null }) => Promise<void>;
  updateCredentialEvent: (id: string, updates: { name?: string; config?: object; enabled?: boolean }) => Promise<void>;
  deleteCredentialEvent: (id: string) => Promise<void>;
}

export const createCredentialSlice: StateCreator<VaultStore, [], [], CredentialSlice> = (set, get) => ({
  credentials: [],
  credentialEvents: [],
  connectorDefinitions: [],
  pendingDeleteCredentialIds: new Set<string>(),
  pendingDeleteEventIds: new Set<string>(),
  recentlyDeletedCredentialIds: new Set<string>(),

  fetchCredentials: async () =>
    credentialsFetch.run("credentials", async () => {
      try {
        const raw = await listCredentials();
        const fetched = raw.map(toCredMeta);
        set((state) => {
          const tombstones = state.recentlyDeletedCredentialIds;
          if (tombstones.size === 0) {
            return { credentials: fetched, error: null };
          }
          // A delete that committed after this fetch started left the row in
          // the snapshot we just received. Filter tombstoned ids out so the
          // wholesale overwrite can't resurrect a credential the user deleted.
          const credentials = fetched.filter((c) => !tombstones.has(c.id));
          // Retire tombstones the backend has caught up on — an id no longer
          // present in a fresh snapshot can never be resurrected again, so it
          // need not be tracked. Allocate a new set only if something changes.
          const presentIds = new Set(fetched.map((c) => c.id));
          let nextTombstones: Set<string> | null = null;
          for (const id of tombstones) {
            if (!presentIds.has(id)) {
              if (!nextTombstones) nextTombstones = new Set(tombstones);
              nextTombstones.delete(id);
            }
          }
          return nextTombstones
            ? { credentials, error: null, recentlyDeletedCredentialIds: nextTombstones }
            : { credentials, error: null };
        });
      } catch (err) {
        reportError(err, "Failed to fetch credentials", set);
        throw err;
      }
    }),

  createCredential: async (input) => {
    try {
      // Encrypt the sensitive data payload before sending over IPC
      const session_encrypted_data = await encryptWithSessionKey(JSON.stringify(input.data));

      const created = await createCredential({
        name: input.name,
        serviceType: input.service_type,
        encryptedData: "", // Sent as sessionEncryptedData instead
        iv: "",
        metadata: null,
        sessionEncryptedData: session_encrypted_data,
        healthcheckPassed: input.healthcheck_passed ?? null,
      });
      // Optimistic: append the returned credential instead of re-fetching the full list
      const credMeta = toCredMeta(created);
      set((state) => ({
        credentials: [...state.credentials, credMeta],
        error: null,
      }));
      return created.id;
    } catch (err) {
      reportError(err, "Failed to create credential", set);
      throw err;
    }
  },

  updateCredential: async (id, input) => {
    try {
      let session_encrypted_data: string | undefined = undefined;
      if (input.data) {
        session_encrypted_data = await encryptWithSessionKey(JSON.stringify(input.data));
      }

      const updated = await updateCredential(id, {
        name: input.name ?? null,
        serviceType: input.service_type ?? null,
        encryptedData: null,
        iv: null,
        metadata: null,
        sessionEncryptedData: session_encrypted_data ?? null,
      });
      // Optimistic: replace the updated credential in-place instead of re-fetching
      const credMeta = toCredMeta(updated);
      set((state) => ({
        credentials: state.credentials.map((c) => (c.id === id ? credMeta : c)),
        error: null,
      }));
    } catch (err) {
      // Rethrow to match createCredential's contract: callers that gate UI
      // transitions (close modal, navigate, toast "Saved") on `await` must see
      // a rejected backend write as failure, not silently succeed.
      reportError(err, "Failed to update credential", set);
      throw err;
    }
  },

  deleteCredential: async (id) => {
    // Mark as pending delete (greyed out, non-interactive in UI)
    set((state) => ({
      pendingDeleteCredentialIds: new Set(state.pendingDeleteCredentialIds).add(id),
    }));
    try {
      await deleteCredential(id);
      set((state) => {
        const next = new Set(state.pendingDeleteCredentialIds);
        next.delete(id);
        return {
          credentials: state.credentials.filter((c) => c.id !== id),
          credentialEvents: state.credentialEvents.filter((e) => e.credential_id !== id),
          pendingDeleteCredentialIds: next,
          // Tombstone the id so a fetchCredentials already in flight (its
          // pre-delete snapshot still lists this row) can't resurrect it when
          // it resolves after us. fetchCredentials retires the tombstone once a
          // fresh snapshot confirms the backend no longer returns the row.
          recentlyDeletedCredentialIds: new Set(state.recentlyDeletedCredentialIds).add(id),
          error: null,
        };
      });
    } catch (err) {
      // Restore: remove from pending set and show error toast
      set((state) => {
        const next = new Set(state.pendingDeleteCredentialIds);
        next.delete(id);
        return { pendingDeleteCredentialIds: next };
      });
      reportError(err, "Failed to delete credential", set);
    }
  },

  updateCredentialField: async (id, key, value) => {
    try {
      const sessionEncryptedValue = await encryptWithSessionKey(value);
      await updateCredentialField(id, key, sessionEncryptedValue);
      // Optimistic: bump updated_at locally instead of re-fetching the full list.
      // Field updates don't change credential-level metadata, only the timestamp.
      const now = new Date().toISOString();
      set((state) => ({
        credentials: state.credentials.map((c) =>
          c.id === id ? { ...c, updated_at: now } : c,
        ),
        error: null,
      }));
    } catch (err) {
      // Rethrow to match createCredential's contract: a rejected field write
      // (decryption failure, validation error, DB lock) must not resolve as
      // success — otherwise an edited secret silently never persists.
      reportError(err, "Failed to update credential field", set);
      throw err;
    }
  },

  healthcheckCredential: async (credentialId) => {
    try {
      const result = await healthcheckCredential(credentialId);
      return result;
    } catch (err) {
      return { success: false, message: errMsg(err, "Healthcheck failed") };
    }
  },

  healthcheckCredentialPreview: async (serviceType, fieldValues) => {
    try {
      // Encrypt field values before sending over IPC
      const session_encrypted_data = await encryptWithSessionKey(JSON.stringify(fieldValues));
      
      const result = await healthcheckCredentialPreview(serviceType, session_encrypted_data);
      return result;
    } catch (err) {
      return { success: false, message: errMsg(err, "Healthcheck failed") };
    }
  },

  fetchConnectorDefinitions: async () => {
    try {
      const raw = await listConnectors();
      const all = raw.map(parseConn);
      // Plugin gating — exclude connectors that declare a `requires_plugin`
      // dependency the user has not satisfied. Currently used by the
      // `obsidian_memory` connector which depends on the Obsidian Brain
      // plugin having a configured vault. Re-fetched when the system store
      // signals the dependency state changed.
      const { useSystemStore } = await import("@/stores/systemStore");
      const sysState = useSystemStore.getState();
      const obsidianReady = Boolean(sysState.obsidianVaultPath) && sysState.obsidianConnected;
      const connectorDefinitions = all.filter((def) => {
        const meta = def.metadata as Record<string, unknown> | null | undefined;
        const requires = meta && typeof meta === "object" ? meta.requires_plugin : null;
        if (requires === "obsidian-brain" && !obsidianReady) return false;
        return true;
      });
      set({ connectorDefinitions, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch connector definitions", set);
    }
  },

  createConnectorDefinition: async (input) => {
    try {
      const raw = await createConnector({
        name: input.name,
        label: input.label,
        icon_url: null,
        color: input.color,
        category: input.category,
        fields: input.fields,
        healthcheck_config: input.healthcheck_config ?? null,
        services: input.services,
        events: input.events,
        metadata: input.metadata ?? null,
        is_builtin: input.is_builtin ?? null,
      });
      const connector = parseConn(raw);
      set((state) => ({ connectorDefinitions: [...state.connectorDefinitions, connector], error: null }));
      return connector;
    } catch (err) {
      reportError(err, "Failed to create connector", set);
      throw err;
    }
  },

  deleteConnectorDefinition: async (id) => {
    try {
      const deleted = await deleteConnector(id);
      if (!deleted) {
        set({ error: 'Failed to delete connector' });
        return;
      }
      set((state) => ({
        connectorDefinitions: state.connectorDefinitions.filter((c) => c.id !== id),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete connector", set);
    }
  },

  fetchCredentialEvents: async () => {
    try {
      const allEvents = await listAllCredentialEvents();
      set({ credentialEvents: allEvents, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch credential events", set);
    }
  },

  createCredentialEvent: async (input) => {
    try {
      await createCredentialEvent({
        credential_id: input.credential_id,
        event_template_id: input.event_template_id,
        name: input.name,
        config: input.config ? JSON.stringify(input.config) : null,
        enabled: null,
      });
      set({ error: null });
      await get().fetchCredentialEvents();
    } catch (err) {
      reportError(err, "Failed to create credential event", set);
    }
  },

  updateCredentialEvent: async (id, updates) => {
    try {
      const input = {
        name: updates.name ?? null,
        config: updates.config ? JSON.stringify(updates.config) : null,
        enabled: updates.enabled ?? null,
        last_polled_at: null,
      };
      const updated = await updateCredentialEvent(id, input);
      set((state) => ({
        credentialEvents: state.credentialEvents.map((e) =>
          e.id === id ? updated : e,
        ),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to update credential event", set);
    }
  },

  deleteCredentialEvent: async (id) => {
    // Mark as pending delete
    set((state) => ({
      pendingDeleteEventIds: new Set(state.pendingDeleteEventIds).add(id),
    }));
    try {
      await deleteCredentialEvent(id);
      set((state) => {
        const next = new Set(state.pendingDeleteEventIds);
        next.delete(id);
        return {
          credentialEvents: state.credentialEvents.filter((e) => e.id !== id),
          pendingDeleteEventIds: next,
          error: null,
        };
      });
    } catch (err) {
      set((state) => {
        const next = new Set(state.pendingDeleteEventIds);
        next.delete(id);
        return { pendingDeleteEventIds: next };
      });
      reportError(err, "Failed to delete credential event", set);
    }
  },
});
