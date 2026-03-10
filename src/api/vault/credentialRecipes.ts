import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { CredentialRecipe } from '@/lib/bindings/CredentialRecipe';

export type { CredentialRecipe };

/** Look up a cached recipe by connector name. Returns null if not cached. */
export const getCredentialRecipe = (connectorName: string) =>
  invoke<CredentialRecipe | null>('get_credential_recipe', { connectorName });

/** List all cached recipes, ordered by usage count descending. */
export const listCredentialRecipes = () =>
  invoke<CredentialRecipe[]>('list_credential_recipes');

/** Create or update a recipe for a connector. */
export const upsertCredentialRecipe = (params: {
  connectorName: string;
  connectorLabel: string;
  category: string;
  color: string;
  oauthType?: string | null;
  fieldsJson: string;
  healthcheckJson?: string | null;
  setupInstructions?: string | null;
  summary?: string | null;
  docsUrl?: string | null;
  source?: string;
}) => invoke<CredentialRecipe>('upsert_credential_recipe', params);

/** Increment usage count when a recipe is consumed. */
export const useCredentialRecipe = (connectorName: string) =>
  invoke<void>('use_credential_recipe', { connectorName });
