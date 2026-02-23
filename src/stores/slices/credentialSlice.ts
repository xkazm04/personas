import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type {
  CredentialMetadata,
  ConnectorDefinition,
  DbCredentialEvent,
} from "@/lib/types/types";
import {
  toCredentialMetadata as toCredMeta,
  parseConnectorDefinition as parseConn,
} from "@/lib/types/types";
import * as api from "@/api/tauriApi";

export interface CredentialSlice {
  // State
  credentials: CredentialMetadata[];
  credentialEvents: DbCredentialEvent[];
  connectorDefinitions: ConnectorDefinition[];

  // Actions
  fetchCredentials: () => Promise<void>;
  createCredential: (input: { name: string; service_type: string; data: object }) => Promise<string | undefined>;
  deleteCredential: (id: string) => Promise<void>;
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

export const createCredentialSlice: StateCreator<PersonaStore, [], [], CredentialSlice> = (set, get) => ({
  credentials: [],
  credentialEvents: [],
  connectorDefinitions: [],

  fetchCredentials: async () => {
    try {
      const raw = await api.listCredentials();
      const credentials = raw.map(toCredMeta);
      set({ credentials });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch credentials") });
      throw err;
    }
  },

  createCredential: async (input) => {
    try {
      const created = await api.createCredential({
        name: input.name,
        service_type: input.service_type,
        encrypted_data: JSON.stringify(input.data),
        iv: "",
        metadata: null,
      });
      get().fetchCredentials();
      return created.id;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create credential") });
      return undefined;
    }
  },

  deleteCredential: async (id) => {
    await api.deleteCredential(id);
    set((state) => ({
      credentials: state.credentials.filter((c) => c.id !== id),
      credentialEvents: state.credentialEvents.filter((e) => e.credential_id !== id),
    }));
  },

  healthcheckCredential: async (credentialId) => {
    try {
      const result = await api.healthcheckCredential(credentialId);
      return result;
    } catch (err) {
      return { success: false, message: errMsg(err, "Healthcheck failed") };
    }
  },

  healthcheckCredentialPreview: async (serviceType, fieldValues) => {
    try {
      const result = await api.healthcheckCredentialPreview(serviceType, fieldValues);
      return result;
    } catch (err) {
      return { success: false, message: errMsg(err, "Healthcheck failed") };
    }
  },

  fetchConnectorDefinitions: async () => {
    try {
      const raw = await api.listConnectors();
      const connectorDefinitions = raw.map(parseConn);
      set({ connectorDefinitions });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch connector definitions") });
    }
  },

  createConnectorDefinition: async (input) => {
    try {
      const raw = await api.createConnector({
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
      set((state) => ({ connectorDefinitions: [...state.connectorDefinitions, connector] }));
      return connector;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create connector") });
      throw err;
    }
  },

  deleteConnectorDefinition: async (id) => {
    try {
      await api.deleteConnector(id);
      set((state) => ({
        connectorDefinitions: state.connectorDefinitions.filter((c) => c.id !== id),
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete connector") });
    }
  },

  fetchCredentialEvents: async () => {
    try {
      const allEvents = await api.listAllCredentialEvents();
      set({ credentialEvents: allEvents });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch credential events") });
    }
  },

  createCredentialEvent: async (input) => {
    try {
      await api.createCredentialEvent({
        credential_id: input.credential_id,
        event_template_id: input.event_template_id,
        name: input.name,
        config: input.config ? JSON.stringify(input.config) : null,
        enabled: null,
      });
      get().fetchCredentialEvents();
    } catch (err) {
      set({ error: errMsg(err, "Failed to create credential event") });
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
      const updated = await api.updateCredentialEvent(id, input);
      set((state) => ({
        credentialEvents: state.credentialEvents.map((e) =>
          e.id === id ? updated : e,
        ),
      }));
    } catch (err) {
      set({ error: errMsg(err, 'Failed to update credential event') });
    }
  },

  deleteCredentialEvent: async (id) => {
    try {
      await api.deleteCredentialEvent(id);
      set((state) => ({
        credentialEvents: state.credentialEvents.filter((e) => e.id !== id),
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete credential event") });
    }
  },
});
