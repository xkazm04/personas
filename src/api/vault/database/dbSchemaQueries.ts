import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DbSavedQuery } from "@/lib/bindings/DbSavedQuery";
export type { DbSavedQuery };

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
