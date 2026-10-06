/**
 * plainWords - markdown and ref links resolved to the words a reader sees, for
 * places that show her text as plain prose (the capsule's tooltip, a partial
 * streaming reply). A ref link `[the merge-order call](ref:decision/x)` reads
 * as "the merge-order call", never as its markup.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

export function plainWords(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '');
}

/** The first sentence-or-clause of a prompt, as a heading; the rest as context. */
export function splitLead(raw: string): { lead: string; rest: string } {
  const text = raw.trim();
  if (text.length <= 120) return { lead: text, rest: '' };
  for (const sep of [' — ', ' - ', '? ', '. ', ': ']) {
    const i = text.indexOf(sep, 16);
    if (i > 0 && i < 140) {
      const keep = sep === '? ' || sep === '. ' ? 1 : 0;
      return { lead: text.slice(0, i + keep).trim(), rest: text.slice(i + sep.length).trim() };
    }
  }
  return { lead: text, rest: '' };
}
