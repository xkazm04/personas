import type { StateCreator } from "zustand";
import type { VaultStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { DbSchemaTable, DbSavedQuery, QueryResult } from "@/api/vault/database/dbSchema";
import * as dbApi from "@/api/vault/database/dbSchema";

export interface DatabaseSlice {
  // State
  dbSchemaTables: DbSchemaTable[];
  dbSavedQueries: DbSavedQuery[];

  // Actions -- Schema Tables
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

  // Actions -- Saved Queries
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

  // Actions -- Query Execution
  executeDbQuery: (
    credentialId: string,
    queryText: string,
    savedQueryId?: string,
    allowMutation?: boolean,
  ) => Promise<QueryResult>;
}

export const createDatabaseSlice: StateCreator<VaultStore, [], [], DatabaseSlice> = (set) => ({
  dbSchemaTables: [],
  dbSavedQueries: [],

  // -- Schema Tables --------------------------------------------------

  fetchDbSchemaTables: async (credentialId) => {
    try {
      const tables = await dbApi.listDbSchemaTables(credentialId);
      set({ dbSchemaTables: tables });
    } catch (err) {
      reportError(err, "Failed to fetch schema tables", set);
    }
  },

  createDbSchemaTable: async (credentialId, tableName, displayLabel, columnHints) => {
    try {
      const table = await dbApi.createDbSchemaTable(credentialId, tableName, displayLabel, columnHints);
      set((state) => ({ dbSchemaTables: [...state.dbSchemaTables, table] }));
      return table;
    } catch (err) {
      reportError(err, "Failed to create schema table", set);
      return undefined;
    }
  },

  updateDbSchemaTable: async (id, updates) => {
    try {
      const updated = await dbApi.updateDbSchemaTable(id, updates);
      set((state) => ({
        dbSchemaTables: state.dbSchemaTables.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (err) {
      reportError(err, "Failed to update schema table", set);
    }
  },

  deleteDbSchemaTable: async (id) => {
    try {
      await dbApi.deleteDbSchemaTable(id);
      set((state) => ({
        dbSchemaTables: state.dbSchemaTables.filter((t) => t.id !== id),
      }));
    } catch (err) {
      reportError(err, "Failed to delete schema table", set);
    }
  },

  // -- Saved Queries --------------------------------------------------

  fetchDbSavedQueries: async (credentialId) => {
    try {
      const queries = await dbApi.listDbSavedQueries(credentialId);
      set({ dbSavedQueries: queries });
    } catch (err) {
      reportError(err, "Failed to fetch saved queries", set);
    }
  },

  createDbSavedQuery: async (credentialId, title, queryText, language) => {
    try {
      const query = await dbApi.createDbSavedQuery(credentialId, title, queryText, language);
      set((state) => ({ dbSavedQueries: [...state.dbSavedQueries, query] }));
      return query;
    } catch (err) {
      reportError(err, "Failed to create saved query", set);
      return undefined;
    }
  },

  updateDbSavedQuery: async (id, updates) => {
    try {
      const updated = await dbApi.updateDbSavedQuery(id, updates);
      set((state) => ({
        dbSavedQueries: state.dbSavedQueries.map((q) => (q.id === id ? updated : q)),
      }));
    } catch (err) {
      reportError(err, "Failed to update saved query", set);
    }
  },

  deleteDbSavedQuery: async (id) => {
    try {
      await dbApi.deleteDbSavedQuery(id);
      set((state) => ({
        dbSavedQueries: state.dbSavedQueries.filter((q) => q.id !== id),
      }));
    } catch (err) {
      reportError(err, "Failed to delete saved query", set);
    }
  },

  // -- Query Execution ------------------------------------------------

  executeDbQuery: async (credentialId, queryText, savedQueryId, allowMutation) => {
    return dbApi.executeDbQuery(credentialId, queryText, savedQueryId, allowMutation);
  },
});
