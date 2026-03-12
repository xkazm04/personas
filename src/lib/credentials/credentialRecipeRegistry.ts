/**
 * credentialRecipeRegistry -- shared credential recipe cache that any discovery
 * path (Design, Negotiator, AutoCred) can populate or consume.
 *
 * When the Design path discovers a connector's credential schema (fields,
 * OAuth config, healthcheck), it saves a recipe. Subsequent Negotiator or
 * AutoCred sessions for the same connector skip AI discovery and reuse it.
 */
import {
  getCredentialRecipe,
  upsertCredentialRecipe,
  useCredentialRecipe,
  type CredentialRecipe,
} from '@/api/vault/credentialRecipes';
import type { CredentialDesignResult, CredentialDesignConnector } from '@/hooks/design/credential/useCredentialDesign';

// -- In-memory cache -----------------------------------------------------
// Avoids redundant IPC round-trips for the same connector within a session.

const memoryCache = new Map<string, CredentialRecipe>();

/** Clear the in-memory cache (e.g. on logout or data reset). */
export function clearRecipeCache(): void {
  memoryCache.clear();
}

// -- Lookup --------------------------------------------------------------

/**
 * Look up a cached recipe for a connector name.
 * Checks the in-memory cache first, then falls back to the DB.
 * Returns null if no recipe exists.
 */
export async function lookupRecipe(connectorName: string): Promise<CredentialRecipe | null> {
  const cached = memoryCache.get(connectorName);
  if (cached) return cached;

  try {
    const recipe = await getCredentialRecipe(connectorName);
    if (recipe) {
      memoryCache.set(connectorName, recipe);
    }
    return recipe;
  } catch {
    return null;
  }
}

/**
 * Look up a recipe and convert it to a CredentialDesignResult shape
 * that the Negotiator and AutoCred paths can consume directly.
 * Increments usage_count on hit.
 */
export async function lookupRecipeAsDesignResult(
  connectorName: string,
): Promise<CredentialDesignResult | null> {
  const recipe = await lookupRecipe(connectorName);
  if (!recipe) return null;

  // Increment usage count in the background
  void useCredentialRecipe(connectorName).catch(() => {/* non-critical */});

  return recipeToDesignResult(recipe);
}

// -- Save ----------------------------------------------------------------

/**
 * Save a recipe from a successful credential design result.
 * Called by the Design path after a connector is successfully created.
 */
export async function saveRecipeFromDesign(
  result: CredentialDesignResult,
  source: string = 'design',
): Promise<CredentialRecipe | null> {
  const conn = result.connector;
  if (!conn?.name) return null;

  // Extract docs URL from setup instructions
  let docsUrl: string | null = null;
  if (result.setup_instructions) {
    const match = result.setup_instructions.match(/https?:\/\/[^\s)]+/);
    if (match) docsUrl = match[0]!;
  }

  try {
    const recipe = await upsertCredentialRecipe({
      connectorName: conn.name,
      connectorLabel: conn.label,
      category: conn.category,
      color: conn.color,
      oauthType: conn.oauth_type ?? null,
      fieldsJson: JSON.stringify(conn.fields),
      healthcheckJson: conn.healthcheck_config ? JSON.stringify(conn.healthcheck_config) : null,
      setupInstructions: result.setup_instructions || null,
      summary: result.summary || null,
      docsUrl,
      source,
    });

    memoryCache.set(conn.name, recipe);
    return recipe;
  } catch {
    // Non-critical -- recipe caching is an optimization, not a requirement
    return null;
  }
}

// -- Conversion helpers --------------------------------------------------

/** Convert a persisted recipe back to a CredentialDesignResult shape. */
export function recipeToDesignResult(recipe: CredentialRecipe): CredentialDesignResult {
  let fields: CredentialDesignConnector['fields'] = [];
  try {
    fields = JSON.parse(recipe.fields_json);
  } catch { /* intentional: fallback to empty */ }

  let healthcheckConfig: object | null = null;
  if (recipe.healthcheck_json) {
    try {
      healthcheckConfig = JSON.parse(recipe.healthcheck_json);
    } catch { /* intentional: fallback to null */ }
  }

  return {
    match_existing: recipe.connector_name,
    connector: {
      name: recipe.connector_name,
      label: recipe.connector_label,
      category: recipe.category,
      color: recipe.color,
      oauth_type: recipe.oauth_type,
      fields,
      healthcheck_config: healthcheckConfig,
      services: [],
      events: [],
    },
    setup_instructions: recipe.setup_instructions ?? '',
    summary: recipe.summary ?? '',
  };
}

/** Convert a recipe to the connector context shape used by AutoCred. */
export function recipeToConnectorContext(recipe: CredentialRecipe) {
  let fields: CredentialDesignConnector['fields'] = [];
  try {
    fields = JSON.parse(recipe.fields_json);
  } catch { /* intentional: fallback to empty */ }

  return {
    connectorName: recipe.connector_name,
    connectorLabel: recipe.connector_label,
    oauthType: recipe.oauth_type,
    fields,
    healthcheckJson: recipe.healthcheck_json,
    docsUrl: recipe.docs_url,
    setupInstructions: recipe.setup_instructions,
  };
}
