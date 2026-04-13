import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DbSchemaTable } from "@/lib/bindings/DbSchemaTable";
export type { DbSchemaTable };

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

// -- Schema Introspection ----------------------------------------------

export const introspectDbTables = (credentialId: string) =>
  invoke<import("@/lib/bindings/QueryResult").QueryResult>('introspect_db_tables', { credentialId });

export const introspectDbColumns = (credentialId: string, tableName: string) =>
  invoke<import("@/lib/bindings/QueryResult").QueryResult>('introspect_db_columns', { credentialId, tableName });
