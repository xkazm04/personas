/**
 * What the address bar offers while the operator types — pure, so the ranking
 * is a unit test rather than a thing you have to drive a browser to see.
 *
 * THE LIST IS THE WHITELIST AND NOTHING ELSE. This is not history and not a
 * search engine: every line is a row the gate would accept, which is the only
 * kind of suggestion that is honest here. A PAUSED row is still shown — the
 * operator asked for that site and deserves to be told it exists — but it is
 * NOT selectable, because navigating to it would be refused and a suggestion
 * that fires a doomed call is worse than no suggestion.
 *
 * A PATTERN ROW SUGGESTS A CONCRETE EXPANSION, and the expansion is deliberately
 * unambitious: `*.example.com` expands to `example.com` (the apex, which the
 * pattern always covers) and `:*` takes the port the operator actually typed,
 * or no port at all. It never invents `:3000` or `:8080` out of nowhere — a
 * guessed port is a navigation to a page nobody asked for.
 */
import {
  isBrowserOriginPattern,
  parseBrowserOrigin,
  type BrowserOrigin,
  type BrowserSite,
} from '../types';

/** How the query met the row, best first. Exported so a test can name a rank. */
export type SuggestionKind = 'prefix' | 'host' | 'label' | 'fuzzy';

const KIND_ORDER: Record<SuggestionKind, number> = {
  prefix: 0,
  host: 1,
  label: 2,
  fuzzy: 3,
};

export interface OriginSuggestion {
  /** The row this came from — the popup renders its label and paused state. */
  site: BrowserSite;
  /** Where selecting this line would navigate. Equals `site.origin` unless it is a pattern. */
  target: BrowserOrigin;
  /** True when `site.origin` carries a wildcard and `target` is its expansion. */
  pattern: boolean;
  /** False for a paused row: the gate would refuse it, so the popup will not fire it. */
  selectable: boolean;
  kind: SuggestionKind;
}

/** Never more than this many lines, however many rows match. */
export const MAX_ORIGIN_SUGGESTIONS = 8;

function stripScheme(value: string): string {
  return value.replace(/^https?:\/\//, '');
}

/** The host of an origin, without the `*.` label and without the port. */
function hostOf(origin: string): string {
  return parseBrowserOrigin(origin)?.host ?? stripScheme(origin.toLowerCase()).split(':')[0] ?? '';
}

/** The port the operator typed, if they typed one. `:*` is not a port to copy. */
export function portFromQuery(query: string): string | null {
  const match = /:(\d{1,5})$/.exec(stripScheme(query.trim().toLowerCase()));
  return match?.[1] ?? null;
}

/**
 * The concrete origin a pattern stands for, given what the operator has typed.
 *
 * `*.example.com` → `example.com`; `http://localhost:*` → `http://localhost`,
 * or `http://localhost:3000` when `3000` is the port in the query. A row that
 * is already concrete comes back unchanged.
 */
export function expandOriginPattern(origin: string, portHint: string | null = null): BrowserOrigin {
  const parts = parseBrowserOrigin(origin);
  if (!parts) return origin;
  const port = parts.port === '*' ? portHint : parts.port;
  return `${parts.scheme}://${parts.host}${port ? `:${port}` : ''}`;
}

/** `abc` is a subsequence of `a-b-c`. The weakest match this offers. */
function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return false;
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
}

/** The best rank this row can claim for this query, or null when it does not match. */
function rankOf(site: BrowserSite, target: string, query: string): SuggestionKind | null {
  const bare = stripScheme(query);
  const label = site.label.toLowerCase();
  // A pattern row is matched on BOTH the pattern as written and the concrete
  // expansion, so typing `example.com` finds `https://*.example.com`.
  const origins = [site.origin.toLowerCase(), target.toLowerCase()];

  for (const origin of origins) {
    if (origin.startsWith(query) || stripScheme(origin).startsWith(bare)) return 'prefix';
  }
  for (const origin of origins) {
    if (hostOf(origin).includes(bare)) return 'host';
  }
  if (label.includes(query)) return 'label';
  for (const origin of origins) {
    if (isSubsequence(bare, hostOf(origin))) return 'fuzzy';
  }
  return null;
}

/**
 * Rank the whitelist against what has been typed.
 *
 * Order: enabled rows first (a paused row can never be navigated to, so it
 * belongs under every row that can), then match quality, then alphabetically so
 * the list does not reshuffle between two equally good rows.
 */
export function suggestOrigins(
  query: string,
  sites: readonly BrowserSite[],
  limit: number = MAX_ORIGIN_SUGGESTIONS,
): OriginSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const portHint = portFromQuery(q);

  const matched: OriginSuggestion[] = [];
  for (const site of sites) {
    const pattern = isBrowserOriginPattern(site.origin);
    const target = pattern ? expandOriginPattern(site.origin, portHint) : site.origin;
    const kind = rankOf(site, target, q);
    if (!kind) continue;
    matched.push({ site, target, pattern, selectable: site.enabled, kind });
  }

  matched.sort((a, b) => {
    if (a.selectable !== b.selectable) return a.selectable ? -1 : 1;
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    return a.target.localeCompare(b.target);
  });

  return matched.slice(0, limit);
}
