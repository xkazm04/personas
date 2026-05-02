import type { Eligibility, Recipe } from './types';

/**
 * Pure eligibility resolver — given a recipe and a snapshot of the target
 * persona's connector wiring + the user's connector catalog, return the
 * 3-state verdict.
 *
 * Stateless and side-effect-free so it can be called from any layer
 * (browse list, detail header, adopt button, SigilGrid empty-tile hover).
 *
 * Inputs:
 *   - `recipe.requiredConnectors` is the source of truth for what's needed.
 *   - `personaConnectors` = connector slugs already wired on the persona
 *     (derived upstream from the persona's tool/credential bindings).
 *   - `availableConnectors` = connector slugs the user *could* wire — the
 *     intersection of (a) connectors in CONNECTOR_META, (b) the user's
 *     tier permissions, (c) platform capabilities. Pass the full
 *     `Object.keys(CONNECTOR_META)` set in v1 if no tier gating exists yet.
 *
 * Output mapping:
 *   - All required connectors wired → `eligible`.
 *   - Some required missing but all are in `availableConnectors` →
 *     `adoptable-with-setup` with the missing list (caller drives the
 *     wiring flow in adoption order).
 *   - Any required connector not in `availableConnectors` → `incompatible`
 *     with a human-readable reason. Even one un-wireable connector
 *     short-circuits to incompatible — there's no point asking a user to
 *     wire what they can't.
 */
export function resolveEligibility(
  recipe: Recipe,
  personaConnectors: ReadonlySet<string>,
  availableConnectors: ReadonlySet<string>,
): Eligibility {
  const required = recipe.requiredConnectors;
  const missing = required.filter((c) => !personaConnectors.has(c));
  if (missing.length === 0) return { state: 'eligible' };

  const blocked = missing.filter((c) => !availableConnectors.has(c));
  if (blocked.length > 0) {
    const list = blocked.map(prettyConnector).join(', ');
    const reason = blocked.length === 1
      ? `${list} isn't available on this setup`
      : `These connectors aren't available on this setup: ${list}`;
    return { state: 'incompatible', reason, blockedConnectors: blocked };
  }

  return { state: 'adoptable-with-setup', missingConnectors: missing };
}

/** Human-readable connector label fallback. We don't import CONNECTOR_META
 *  here to keep this file dependency-free for unit-testing — callers that
 *  want a brand-correct label can post-process via `getConnectorMeta`. */
function prettyConnector(slug: string): string {
  return slug
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
