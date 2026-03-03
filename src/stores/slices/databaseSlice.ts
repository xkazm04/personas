import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type { DbSchemaTable, DbSavedQuery, QueryResult } from "@/api/dbSchema";
import * as dbApi from "@/api/dbSchema";

export interface DatabaseSlice {
  // State
  dbSchemaTables: DbSchemaTable[];
  dbSavedQueries: DbSavedQuery[];

  // Actions — Schema Tables
  fetchDbSchemaTables: (credentialId: string) => Promise<void>;
  createDbSchemaTable: (
    credentialId: string,
    tableName: string,
    displayLabel?: string | null,
    columnHints?: string | null,
  ) => Promise<DbSchemaTable | undefined>;
  updateDbSchemaTable: (
    id: string,
    updates: Parameters<typeof dbApi.updateDbSchemaTable>[1],
  ) => Promise<void>;
  deleteDbSchemaTable: (id: string) => Promise<void>;

  // Actions — Saved Queries
  fetchDbSavedQueries: (credentialId: string) => Promise<void>;
  createDbSavedQuery: (
    credentialId: string,
    title: string,
    queryText: string,
    language?: string,
  ) => Promise<DbSavedQuery | undefined>;
  updateDbSavedQuery: (
    id: string,
    updates: Parameters<typeof dbApi.updateDbSavedQuery>[1],
  ) => Promise<void>;
  deleteDbSavedQuery: (id: string) => Promise<void>;

  // Actions — Query Execution
  executeDbQuery: (
    credentialId: string,
    queryText: string,
  ) => Promise<QueryResult>;
}

export const createDatabaseSlice: StateCreator<PersonaStore, [], [], DatabaseSlice> = (set, get) => ({
  dbSchemaTables: [],
  dbSavedQueries: [],

  // ── Schema Tables ──────────────────────────────────────────────────

  fetchDbSchemaTables: async (credentialId) => {
    try {
      const tables = await dbApi.listDbSchemaTables(credentialId);
      set({ dbSchemaTables: tables });
    } catch (err) {
      console.error(errMsg(err, "Failed to fetch schema tables"));
    }
  },

  createDbSchemaTable: async (credentialId, tableName, displayLabel, columnHints) => {
    try {
      const table = await dbApi.createDbSchemaTable(credentialId, tableName, displayLabel, columnHints);
      set({ dbSchemaTables: [...get().dbSchemaTables, table] });
      return table;
    } catch (err) {
      console.error(errMsg(err, "Failed to create schema table"));
      return undefined;
    }
  },

  updateDbSchemaTable: async (id, updates) => {
    try {
      const updated = await dbApi.updateDbSchemaTable(id, updates);
      set({
        dbSchemaTables: get().dbSchemaTables.map((t) => (t.id === id ? updated : t)),
      });
    } catch (err) {
      console.error(errMsg(err, "Failed to update schema table"));
    }
  },

  deleteDbSchemaTable: async (id) => {
    try {
      await dbApi.deleteDbSchemaTable(id);
      set({
        dbSchemaTables: get().dbSchemaTables.filter((t) => t.id !== id),
      });
    } catch (err) {
      console.error(errMsg(err, "Failed to delete schema table"));
    }
  },

  // ── Saved Queries ──────────────────────────────────────────────────

  fetchDbSavedQueries: async (credentialId) => {
    try {
      const queries = await dbApi.listDbSavedQueries(credentialId);
      set({ dbSavedQueries: queries });
    } catch (err) {
      console.error(errMsg(err, "Failed to fetch saved queries"));
    }
  },

  createDbSavedQuery: async (credentialId, title, queryText, language) => {
    try {
      const query = await dbApi.createDbSavedQuery(credentialId, title, queryText, language);
      set({ dbSavedQueries: [...get().dbSavedQueries, query] });
      return query;
    } catch (err) {
      console.error(errMsg(err, "Failed to create saved query"));
      return undefined;
    }
  },

  updateDbSavedQuery: async (id, updates) => {
    try {
      const updated = await dbApi.updateDbSavedQuery(id, updates);
      set({
        dbSavedQueries: get().dbSavedQueries.map((q) => (q.id === id ? updated : q)),
      });
    } catch (err) {
      console.error(errMsg(err, "Failed to update saved query"));
    }
  },

  deleteDbSavedQuery: async (id) => {
    try {
      await dbApi.deleteDbSavedQuery(id);
      set({
        dbSavedQueries: get().dbSavedQueries.filter((q) => q.id !== id),
      });
    } catch (err) {
      console.error(errMsg(err, "Failed to delete saved query"));
    }
  },

  // ── Query Execution ────────────────────────────────────────────────

  executeDbQuery: async (credentialId, queryText) => {
    return dbApi.executeDbQuery(credentialId, queryText);
  },
});
