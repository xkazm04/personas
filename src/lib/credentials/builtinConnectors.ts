/**
 * Builtin connector definitions -- committed to the repo so all users get the same catalog.
 * Each JSON file in scripts/connectors/builtin/ defines a single connector.
 *
 * BuiltinConnectorDef extends the shared ConnectorDefinitionBase so that builtin
 * connectors and Rust-backed connectors share the same field/event types.
 */

import type { ConnectorDefinitionBase } from '@/lib/types/types';

/**
 * Builtin connector shape -- extends the shared ConnectorDefinitionBase.
 */
export type BuiltinConnectorDef = ConnectorDefinitionBase;

/**
 * Every seed JSON, discovered rather than listed. The hand-written import list
 * this replaces had drifted to 100 of the 135 files the Rust seed
 * (scripts/generate-connector-seed.mjs -> builtin_connectors.rs) ships, so 35
 * real vault connectors (stripe, n8n, zapier, the cloud and research
 * connectors, the webhooks...) were invisible here: an import asked for none of
 * their fields, their template pills read as unknown categories, and three
 * categories (vision, observability, personalization) looked uncoverable.
 *
 * The assertion: each file is one connector object in the seed format (the
 * seed generator reads the same directory). Four seeds omit
 * `healthcheck_config` and one omits `services`/`events`, so the optional
 * collections are defaulted here; the test beside this file checks every
 * seed for the required scalar keys and a `fields` array.
 * Sorted by path so the order is stable across platforms.
 */
const SEED_MODULES = import.meta.glob<Partial<BuiltinConnectorDef>>(
  '../../../scripts/connectors/builtin/*.json',
  { eager: true, import: 'default' },
);

export const BUILTIN_CONNECTORS: BuiltinConnectorDef[] = Object.keys(SEED_MODULES)
  .sort()
  .map((path) => ({
    healthcheck_config: null,
    metadata: null,
    services: [],
    events: [],
    ...SEED_MODULES[path],
  }) as BuiltinConnectorDef);

/**
 * Return every category tag claimed by a connector — unions the legacy
 * singular `category` string with the multi-tag `categories[]` array (if
 * present on the JSON). Empty array if the name is unknown.
 *
 * A connector may participate in several template slots (e.g. Leonardo AI is
 * both `image_generation` and `video_generation`). Templates that ask for a
 * category-level credential match against this function.
 */
export function connectorCategoryTags(connectorName: string): string[] {
  const c = BUILTIN_CONNECTORS.find((x) => x.name === connectorName) as
    | (BuiltinConnectorDef & { categories?: unknown })
    | undefined;
  if (!c) return [];
  const tags = new Set<string>();
  if (c.category) tags.add(c.category);
  const multi = (c as { categories?: unknown }).categories;
  if (Array.isArray(multi)) {
    for (const t of multi) if (typeof t === 'string') tags.add(t);
  }
  return Array.from(tags);
}

/** Connectors whose category tags include the requested tag. */
export function connectorsInCategory(category: string): BuiltinConnectorDef[] {
  return BUILTIN_CONNECTORS.filter((c) =>
    connectorCategoryTags(c.name).includes(category),
  );
}
