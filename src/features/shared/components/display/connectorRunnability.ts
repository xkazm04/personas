/**
 * Frontend mirror of the Rust adoption pre-flight in
 * `commands::design::template_adopt::check_persona_runnability`.
 *
 * The Design tab's ConnectorsSection used to flag any connector as
 * "needs setup" unless the persona's `design_context.credentialLinks`
 * carried an explicit binding. But instant-adopted personas have empty
 * credentialLinks, AND they declare connectors by ROLE (`codebase`,
 * `messaging`, `knowledge_base`) instead of the actual connector
 * definition name (`github`, `personas_messages`, `notion`) — so every
 * adopted persona showed amber "needs setup" alerts even when the vault
 * had matching credentials.
 *
 * This module resolves a connector name to one of three states using the
 * same rules as adoption pre-flight:
 *
 *   - `native`       — Claude Code handles this natively (web_search,
 *                      web_fetch, web_scraping, bash, filesystem, etc.).
 *                      No credential needed.
 *   - `satisfied`    — Either an explicit credentialLink, an exact
 *                      service_type match, OR a category match (after
 *                      role normalization).
 *   - `needs_setup`  — None of the above; the user needs to add a
 *                      credential or wire one in.
 */
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

/** Connector roles emitted by templates that don't match a
 *  `connector_definitions.category` literally. Mirror of the Rust
 *  `normalize_connector_role`. */
const ROLE_SYNONYMS: Record<string, string> = {
  codebase: 'source_control',
  source_code: 'source_control',
  vcs: 'source_control',
  git: 'source_control',
  image_generation: 'ai',
  image: 'ai',
  image_ai: 'ai',
  media_generation: 'ai',
  llm: 'ai',
  language_model: 'ai',
  inbox: 'email',
  mail: 'email',
  chat: 'messaging',
  notifications: 'messaging',
  docs: 'knowledge_base',
  wiki: 'knowledge_base',
  documents: 'knowledge_base',
  files: 'storage',
  fs: 'storage',
  object_storage: 'storage',
  metrics: 'monitoring',
  observability: 'monitoring',
  errors: 'monitoring',
  tasks: 'project_management',
  issues: 'project_management',
};

/** Capabilities Claude Code provides natively. No vault entry needed. */
const NATIVE_CAPABILITIES = new Set([
  'web_search',
  'websearch',
  'web_fetch',
  'webfetch',
  'web_scraping',
  'web_scrape',
  'web',
  'code_execution',
  'shell',
  'bash',
  'file_read',
  'file_write',
  'filesystem',
  'rss',
  'rss_feeds',
]);

/** Built-in local resources that don't need a vault credential. */
const BUILTIN_LOCAL_CONNECTORS = new Set([
  'local_drive',
  'personas_database',
  'personas_messages',
  'personas_vector_db',
]);

export type ConnectorRunnabilityStatus = 'native' | 'satisfied' | 'needs_setup';

export interface ConnectorRunnabilityInput {
  /** Connector name as declared on the persona (e.g. `codebase`, `gmail`, `web_scraping`). */
  name: string;
  /** Optional category declared on the persona's connector entry. */
  category?: string | null;
  /** Persona's explicit credential-link map (from `design_context.credentialLinks`). */
  credentialLinks: Record<string, string>;
  /** All vault credentials available to the user. */
  credentials: ReadonlyArray<CredentialMetadata>;
  /** Catalog of installed connector definitions (used for category matching). */
  connectorDefinitions: ReadonlyArray<ConnectorDefinition>;
}

export interface ConnectorRunnabilityResult {
  status: ConnectorRunnabilityStatus;
  /** When `satisfied`, the matching credential (for badge + healthcheck display). */
  credential?: CredentialMetadata;
  /** Human-readable reason for the badge tooltip. */
  reason: string;
}

function isNative(name: string): boolean {
  return NATIVE_CAPABILITIES.has(name.toLowerCase());
}

function normalizeRole(name: string): string {
  const lower = name.toLowerCase();
  return ROLE_SYNONYMS[lower] ?? lower;
}

export function resolveConnectorRunnability(
  input: ConnectorRunnabilityInput,
): ConnectorRunnabilityResult {
  const name = input.name.trim();
  const lower = name.toLowerCase();

  // 1. Native CLI capability — never needs a credential.
  if (isNative(lower)) {
    return { status: 'native', reason: 'Handled natively by Claude Code' };
  }
  if (input.category && isNative(input.category.toLowerCase())) {
    return { status: 'native', reason: 'Handled natively by Claude Code' };
  }

  // 2. Built-in local resource — always satisfied.
  if (BUILTIN_LOCAL_CONNECTORS.has(lower)) {
    return { status: 'satisfied', reason: 'Built-in local resource' };
  }

  // 3. Explicit credentialLinks binding (per-persona).
  const linkedId = input.credentialLinks[name] ?? input.credentialLinks[lower];
  if (linkedId) {
    const cred = input.credentials.find((c) => c.id === linkedId);
    if (cred) {
      return { status: 'satisfied', credential: cred, reason: 'Linked credential' };
    }
  }

  // 4. Exact service_type match in vault.
  const byServiceType = input.credentials.find(
    (c) => c.service_type.toLowerCase() === lower,
  );
  if (byServiceType) {
    return { status: 'satisfied', credential: byServiceType, reason: 'Matching credential in vault' };
  }

  // 5. Category match after synonym normalization.
  const targetCategory = normalizeRole(name);
  const matchingDef = input.connectorDefinitions.find(
    (d) => d.category.toLowerCase() === targetCategory,
  );
  if (matchingDef) {
    const credForCat = input.credentials.find(
      (c) => c.service_type.toLowerCase() === matchingDef.name.toLowerCase(),
    );
    if (credForCat) {
      return {
        status: 'satisfied',
        credential: credForCat,
        reason: `${matchingDef.label} satisfies "${name}" (${targetCategory})`,
      };
    }
  }

  return {
    status: 'needs_setup',
    reason: `No vault credential found for "${name}" (category: ${targetCategory})`,
  };
}
