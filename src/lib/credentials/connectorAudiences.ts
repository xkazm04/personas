/**
 * Connector audiences — "who hires this tool".
 *
 * Replaces the prior `ROLE_PRESETS` map (developer/support/manager →
 * categories) which forced category to imply audience and required cross-file
 * edits whenever a new connector or category showed up. Audiences are now
 * declared per-connector and may overlap (Sentry is monitoring AND support;
 * Linear is project_management AND developer). The picker aggregates these
 * emergently — there is no authored preset.
 *
 * The data ideally lives in builtin connector metadata (`scripts/connectors/
 * builtin/<name>.json -> metadata.audiences`). Until every JSON is migrated,
 * `getAudiencesForConnector` first reads from a connector's own metadata blob
 * and falls back to this static table for connectors that have not yet been
 * tagged. Both sources may contribute — they are unioned.
 */

export type Audience = 'developer' | 'support' | 'manager';

export const ALL_AUDIENCES: readonly Audience[] = Object.freeze([
  'developer',
  'support',
  'manager',
]);

/**
 * Per-connector audience declarations. Bridges builtin connectors that
 * haven't yet had `metadata.audiences` populated. Adding a connector that
 * fits no audience is fine — they still surface under category/purpose
 * filters, but won't appear when a role filter is active.
 *
 * This intentionally allows multi-audience tagging: a connector that fits
 * both a manager (project visibility) and a developer (PR/issue automation)
 * use case lists both. Earlier code forced one through the connector's
 * category, which lost precision for tools like Sentry, Linear, Notion.
 */
const FALLBACK_AUDIENCES: Readonly<Record<string, readonly Audience[]>> = Object.freeze({
  // -- Developer-leaning ----------------------------------------------------
  github: ['developer'],
  gitlab: ['developer'],
  azure_devops: ['developer'],
  azure_devops_org: ['developer'],
  bitbucket: ['developer'],
  circleci: ['developer'],
  github_actions: ['developer'],
  vercel: ['developer'],
  netlify: ['developer'],
  cloudflare: ['developer'],
  fly_io: ['developer'],
  railway: ['developer'],
  digitalocean: ['developer'],
  aws: ['developer'],
  aws_s3: ['developer'],
  aws_cloud: ['developer'],
  azure_cloud: ['developer'],
  gcp_cloud: ['developer'],
  kubernetes: ['developer'],
  desktop_docker: ['developer'],
  desktop_browser: ['developer'],
  postgres: ['developer'],
  postgres_proxy: ['developer'],
  mongodb: ['developer'],
  redis: ['developer'],
  duckdb: ['developer'],
  neon: ['developer'],
  supabase: ['developer'],
  convex: ['developer'],
  planetscale: ['developer'],
  upstash: ['developer'],
  personas_database: ['developer'],
  personas_vector_db: ['developer'],
  cloudflare_r2: ['developer'],
  backblaze_b2: ['developer'],
  apify: ['developer'],
  firecrawl: ['developer'],
  arcade: ['developer'],
  mcp_gateway: ['developer'],
  // -- Support-leaning ------------------------------------------------------
  zendesk: ['support'],
  freshdesk: ['support'],
  intercom: ['support', 'manager'],
  crisp: ['support'],
  // -- Multi-audience: monitoring is dev + support -------------------------
  sentry: ['developer', 'support'],
  pagerduty: ['developer', 'support'],
  datadog: ['developer', 'support'],
  betterstack: ['developer', 'support'],
  uptime_robot: ['developer', 'support'],
  snyk: ['developer'],
  // -- Manager-leaning ------------------------------------------------------
  linear: ['developer', 'manager'],
  jira: ['developer', 'manager'],
  asana: ['manager'],
  monday: ['manager'],
  monday_com: ['manager'],
  clickup: ['manager'],
  trello: ['manager'],
  todoist: ['manager'],
  hubspot: ['manager'],
  pipedrive: ['manager'],
  attio: ['manager'],
  // -- Communication: shared across audiences -------------------------------
  slack: ['developer', 'support', 'manager'],
  discord: ['developer'],
  microsoft_teams: ['support', 'manager'],
  telegram: ['developer'],
  gmail: ['support', 'manager'],
  microsoft_outlook: ['support', 'manager'],
  google_calendar: ['manager'],
  microsoft_calendar: ['manager'],
  cal_com: ['manager'],
  calendly: ['manager'],
  notion: ['developer', 'manager'],
  confluence: ['developer', 'manager'],
  airtable: ['manager'],
  // -- Finance / Commerce: manager territory --------------------------------
  stripe: ['manager'],
  paddle: ['manager'],
  quickbooks: ['manager'],
  xero: ['manager'],
  ramp: ['manager'],
  shopify: ['manager'],
  shipstation: ['manager'],
  woocommerce: ['manager'],
  lemonsqueezy: ['manager'],
  // -- Analytics: dev + manager ---------------------------------------------
  mixpanel: ['developer', 'manager'],
  posthog: ['developer', 'manager'],
  google_analytics: ['developer', 'manager'],
  amplitude: ['developer', 'manager'],
  metabase: ['developer', 'manager'],
  // -- Social / Content: manager primarily ----------------------------------
  buffer: ['manager'],
  linkedin: ['manager'],
  google_ads: ['manager'],
  meta_ads: ['manager'],
  linkedin_ads: ['manager'],
});

/** Connector metadata shape carrying optional audience tags. */
export type ConnectorMetadataLike =
  | string
  | Record<string, unknown>
  | null
  | undefined;

/**
 * Read audiences from a connector's metadata. Accepts either the raw JSON
 * string (Rust-side serialization) or the already-parsed object shape that
 * the frontend uses. Tolerates malformed input — returns `[]` rather than
 * throwing.
 */
function audiencesFromMetadata(metadata: ConnectorMetadataLike): Audience[] {
  if (!metadata) return [];
  let parsed: unknown = metadata;
  if (typeof metadata === 'string') {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const raw = (parsed as { audiences?: unknown }).audiences;
  if (!Array.isArray(raw)) return [];
  const out: Audience[] = [];
  for (const a of raw) {
    if (a === 'developer' || a === 'support' || a === 'manager') out.push(a);
  }
  return out;
}

/**
 * Resolve audiences for a connector. Prefers the connector's own
 * `metadata.audiences` (the destination state); falls back to the
 * `FALLBACK_AUDIENCES` table for connectors whose JSON has not been
 * populated yet. The two are unioned, so a partial migration does not
 * regress the filter.
 */
export function getAudiencesForConnector(
  name: string,
  metadata?: ConnectorMetadataLike,
): Audience[] {
  const fromMeta = audiencesFromMetadata(metadata);
  const fromFallback = FALLBACK_AUDIENCES[name] ?? [];
  if (fromMeta.length === 0) return [...fromFallback];
  if (fromFallback.length === 0) return fromMeta;
  // Union, preserving insertion order from metadata first.
  const set = new Set<Audience>(fromMeta);
  for (const a of fromFallback) set.add(a);
  return Array.from(set);
}

/** True when this connector is tagged with the given audience. */
export function connectorMatchesAudience(
  name: string,
  metadata: ConnectorMetadataLike,
  audience: Audience,
): boolean {
  return getAudiencesForConnector(name, metadata).includes(audience);
}
