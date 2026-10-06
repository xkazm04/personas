/**
 * Fusion · text helpers (copied from R5 · A's `plainWords.ts` / `DecisionTiles`
 * so this variant survives that one's removal): markdown and ref links read
 * as plain words, a prompt split into a heading and its context, and inline
 * `**bold**` / `` `code` `` drawn as marks instead of printed as characters.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import type { ReactNode } from 'react';

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

/** `**bold**` and `` `code` `` as real marks, never as literal characters. */
export function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <b key={i}>{part.slice(2, -2)}</b>
      ) : part.startsWith('`') && part.endsWith('`') ? (
        <code key={i} className="typo-code">
          {part.slice(1, -1)}
        </code>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

/** Typing into a field owns the keyboard: no surface key fires there. */
export function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/** The product's ease, for every Fusion transition. */
export const EASE = [0.22, 1, 0.36, 1] as const;
