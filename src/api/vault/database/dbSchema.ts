import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DbSchemaTable } from "@/lib/bindings/DbSchemaTable";
import type { DbSavedQuery } from "@/lib/bindings/DbSavedQuery";
import type { QueryResult } from "@/lib/bindings/QueryResult";
export type { DbSchemaTable, DbSavedQuery, QueryResult };

// -- Schema Tables ------------------------------------------------------

export const listDbSchemaTables = (credentialId: string) =>
  invoke<DbSchemaTable[]>('list_db_schema_tables', { credentialId });

export const createDbSchemaTable = (
  credentialId: string,
  tableName: string,
  displayLabel?: string | null,
  columnHints?: string | null,
) => invoke<DbSchemaTable>('create_db_schema_table', { credentialId, tableName, displayLabel, columnHints });

export const updateDbSchemaTable = (
  id: string,
  updates: {
    tableName?: string;
    displayLabel?: string;
    columnHints?: string;
    isFavorite?: boolean;
    sortOrder?: number;
  },
) => invoke<DbSchemaTable>('update_db_schema_table', { id, ...updates });

export const deleteDbSchemaTable = (id: string) =>
  invoke<boolean>('delete_db_schema_table', { id });

// -- Saved Queries ------------------------------------------------------

export const listDbSavedQueries = (credentialId: string) =>
  invoke<DbSavedQuery[]>('list_db_saved_queries', { credentialId });

export const createDbSavedQuery = (
  credentialId: string,
  title: string,
  queryText: string,
  language?: string,
) => invoke<DbSavedQuery>('create_db_saved_query', { credentialId, title, queryText, language });

export const updateDbSavedQuery = (
  id: string,
  updates: {
    title?: string;
    queryText?: string;
    language?: string;
    isFavorite?: boolean;
    sortOrder?: number;
  },
) => invoke<DbSavedQuery>('update_db_saved_query', { id, ...updates });

export const deleteDbSavedQuery = (id: string) =>
  invoke<boolean>('delete_db_saved_query', { id });

// -- Query Safety Classification ----------------------------------------

/** Returns `true` if the query is classified as a mutation (INSERT, UPDATE, DELETE, DROP, etc.). */
export const classifyDbQuery = (queryText: string) =>
  invoke<boolean>('classify_db_query', { queryText });

// -- Query Execution ----------------------------------------------------

export const executeDbQuery = (credentialId: string, queryText: string, savedQueryId?: string, allowMutation?: boolean, ddlOnly?: boolean) =>
  invoke<QueryResult>('execute_db_query', { credentialId, queryText, savedQueryId, allowMutation, ddlOnly });

// -- Schema Introspection ----------------------------------------------

export const introspectDbTables = (credentialId: string) =>
  invoke<QueryResult>('introspect_db_tables', { credentialId });

export const introspectDbColumns = (credentialId: string, tableName: string) =>
  invoke<QueryResult>('introspect_db_columns', { credentialId, tableName });

// -- Query Debug (AI-assisted) -----------------------------------------

export const startQueryDebug = (
  credentialId: string,
  queryText: string,
  errorContext: string | null,
  serviceType: string,
  debugId: string,
  allowMutations = false,
) => invoke<void>('start_query_debug', { credentialId, queryText, errorContext, serviceType, debugId, allowMutations });

export const cancelQueryDebug = (debugId: string) =>
  invoke<void>('cancel_query_debug', { debugId });
