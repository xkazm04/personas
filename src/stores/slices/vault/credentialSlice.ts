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

export interface CredentialSlice {
  // State
  credentials: CredentialMetadata[];
  credentialEvents: CredentialEvent[];
  connectorDefinitions: ConnectorDefinition[];
  pendingDeleteCredentialIds: Set<string>;
  pendingDeleteEventIds: Set<string>;

  // Actions
  fetchCredentials: () => Promise<void>;
  createCredential: (input: { name: string; service_type: string; data: object }) => Promise<string>;
  updateCredential: (id: string, input: { name?: string; service_type?: string; data?: object }) => Promise<void>;
  deleteCredential: (id: string) => Promise<void>;
  updateCredentialField: (id: string, key: string, value: string, isSensitive: boolean) => Promise<void>;
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

  fetchCredentials: async () => {
    try {
      const raw = await listCredentials();
      const credentials = raw.map(toCredMeta);
      set({ credentials, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch credentials", set);
      throw err;
    }
  },

  createCredential: async (input) => {
    try {
      // Encrypt the sensitive data payload before sending over IPC
      const session_encrypted_data = await encryptWithSessionKey(JSON.stringify(input.data));
      
      const created = await createCredential({
        name: input.name,
        service_type: input.service_type,
        encrypted_data: "", // Sent as session_encrypted_data instead
        iv: "",
        metadata: null,
        session_encrypted_data,
      });
      await get().fetchCredentials();
      set({ error: null });
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

      await updateCredential(id, {
        name: input.name ?? null,
        service_type: input.service_type ?? null,
        encrypted_data: null,
        iv: null,
        metadata: null,
        session_encrypted_data: session_encrypted_data ?? null,
      });
      await get().fetchCredentials();
      set({ error: null });
    } catch (err) {
      reportError(err, "Failed to update credential", set);
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

  updateCredentialField: async (id, key, value, isSensitive) => {
    try {
      let session_encrypted_value: string | undefined = undefined;
      if (isSensitive) {
        session_encrypted_value = await encryptWithSessionKey(value);
      }

      await updateCredentialField(id, key, value, isSensitive, session_encrypted_value);
      await get().fetchCredentials();
      set({ error: null });
    } catch (err) {
      reportError(err, "Failed to update credential field", set);
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
      
      const result = await healthcheckCredentialPreview(serviceType, {}, session_encrypted_data);
      return result;
    } catch (err) {
      return { success: false, message: errMsg(err, "Healthcheck failed") };
    }
  },

  fetchConnectorDefinitions: async () => {
    try {
      const raw = await listConnectors();
      const connectorDefinitions = raw.map(parseConn);
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
