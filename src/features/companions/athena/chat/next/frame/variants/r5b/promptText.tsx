/**
 * A decision's `prompt` is a paragraph of markdown, not a headline. The
 * surface's headline readout takes its first clause whole (never a cut-off
 * sentence: a prompt with no clause break short enough stays whole and the
 * readout wraps), the rest becomes context, and inline marks render as marks.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import type { ReactNode } from 'react';

export function splitPrompt(raw: string): { lead: string; rest: string } {
  const text = raw.trim();
  // A one-line question stays one headline; only a paragraph is split.
  if (text.length <= 120) return { lead: text, rest: '' };
  for (const sep of [' — ', ' - ', '? ', '. ', ': ']) {
    const i = text.indexOf(sep, 20);
    if (i > 0 && i < 140) {
      const keep = sep === '? ' || sep === '. ' ? 1 : 0;
      return { lead: text.slice(0, i + keep).trim(), rest: text.slice(i + sep.length).trim() };
    }
  }
  return { lead: text, rest: '' };
}

/** `**bold**` and `` `code` `` as real marks, never as literal characters. */
export function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>;
      if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="typo-code">{part.slice(1, -1)}</code>;
      return <span key={i}>{part}</span>;
    });
}
