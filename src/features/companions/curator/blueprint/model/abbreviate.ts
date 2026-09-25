/**
 * Two letters per bundle, derived rather than declared.
 *
 * The winner carried a hand-written map of the ten bundles that existed on the
 * day it was drawn. The registry's domains are ITS vocabulary and may grow
 * without this app, so a fixed map would render a new bundle as `??` - an
 * unknown dressed as a label. These are derived from the domains the plan
 * actually carries and extended until every one is distinct, so adding a
 * bundle changes the marks rather than breaking them.
 */

/**
 * Cut by CODEPOINT, never by UTF-16 code unit: a domain whose name opens with
 * an astral-plane character would otherwise be split mid-surrogate and render
 * as a replacement glyph.
 */
function head(value: string, n: number): string {
  return [...value].slice(0, n).join('').toUpperCase();
}

function seed(domain: string): string {
  const parts = domain.split(/[-_/]/).filter(Boolean);
  if (parts.length >= 2) return head(parts[0]!, 1) + head(parts[1]!, 1);
  return head(domain, 2);
}

/** One distinct short mark per domain, in the order given. */
export function abbreviateDomains(domains: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  for (const domain of [...domains].sort()) {
    let mark = seed(domain);
    if (taken.has(mark)) {
      // Walk the domain's own letters until the pair is free; a collision is
      // resolved from the name itself, never by a counter nobody can read.
      const letters = [...domain.replace(/[^a-z]/gi, '').toUpperCase()];
      for (let i = 1; i < letters.length && taken.has(mark); i += 1) {
        mark = (letters[0] ?? '?') + (letters[i] ?? '?');
      }
    }
    taken.add(mark);
    out[domain] = mark;
  }
  return out;
}
