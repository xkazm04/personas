import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { QueryResult } from "@/lib/bindings/QueryResult";
export type { QueryResult };

// -- Query Safety Classification ----------------------------------------

/** Returns `true` if the query is classified as a mutation (INSERT, UPDATE, DELETE, DROP, etc.). */
export const classifyDbQuery = (queryText: string) =>
  invoke<boolean>('classify_db_query', { queryText });

// -- Query Execution ----------------------------------------------------

export const executeDbQuery = (credentialId: string, queryText: string, savedQueryId?: string, allowMutation?: boolean, ddlOnly?: boolean) =>
  invoke<QueryResult>('execute_db_query', { credentialId, queryText, savedQueryId, allowMutation, ddlOnly });

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
