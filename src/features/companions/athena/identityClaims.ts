/**
 * Parser for the user-profile bullets in Athena's `identity.md`, feeding the
 * per-bullet "that's wrong" correction loop in the Brain Viewer.
 *
 * The document has exactly two top-level sections (see
 * `src-tauri/src/companion/templates/identity.md`): the operator's profile
 * (`# About <Name>`) and the companion's own self-model (`# About me`). Only
 * the first is a claim the operator can correct, so the parser takes every
 * `##` bullet EXCEPT the ones under the companion's own section, rather than
 * matching a single seeded operator name. A document with no `#` heading at
 * all is treated as one untitled profile section.
 */

/** Heading paths the companion owns — its self-model, not a claim about the user. */
const ATHENA_HEADINGS = new Set(['about me', 'about myself']);

/** True when this `#` heading introduces the companion's own self-model. */
export function isAthenaSection(h1: string): boolean {
  return ATHENA_HEADINGS.has(h1.trim().toLowerCase());
}

export interface IdentityClaim {
  /** Heading path, e.g. `"About Alex / How he works"` — the diff anchor. */
  section: string;
  bullet: string;
}

/**
 * Extract the operator-profile bullets from identity.md markdown: the heading
 * path plus the bullet text, skipping the parenthesised placeholder seeds the
 * template ships with.
 */
export function parseIdentityClaims(content: string): IdentityClaim[] {
  let h1 = '';
  let h2 = '';
  const claims: IdentityClaim[] = [];
  for (const line of content.split('\n')) {
    const t = line.trimStart();
    if (t.startsWith('# ')) {
      h1 = t.slice(2).trim();
      h2 = '';
    } else if (t.startsWith('## ')) {
      h2 = t.slice(3).trim();
    } else if (t.startsWith('- ') && h2 && !isAthenaSection(h1)) {
      const bullet = t.slice(2).trim();
      // Skip the placeholder seed bullets ("(seeded from intake interview)", …).
      if (bullet && !bullet.startsWith('(')) {
        claims.push({ section: h1 ? `${h1} / ${h2}` : h2, bullet });
      }
    }
  }
  return claims;
}
