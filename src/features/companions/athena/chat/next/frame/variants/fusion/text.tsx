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

/** A whole prompt this short is its own heading; a longer one is cut at its first sentence. */
const WHOLE_LEAD = 120;
/** The longest a cut-off heading may run (a sentence or a titled clause). */
export const MAX_LEAD = 140;

/** A sentence or a titled clause: where it ends and how many separator characters follow. */
interface Cut {
  end: number;
  skip: number;
}

/** The first whole sentence of `line` within the heading budget. */
function sentenceEnd(line: string): Cut | null {
  const window = line.slice(0, MAX_LEAD + 1);
  // ? or ! always ends a sentence; a full stop only when a capital (not an `e.g. foo`) follows.
  const sentence = /[?!](?=\s)|\.(?=\s+[^\sa-z])/g;
  for (let m = sentence.exec(window); m; m = sentence.exec(window)) {
    if (m.index >= 12) return { end: m.index + 1, skip: 1 };
  }
  return null;
}

/** The first titled clause (`Title - detail`, `Title: detail`) within the budget. Never a comma. */
function clauseEnd(line: string): Cut | null {
  const window = line.slice(0, MAX_LEAD + 1);
  for (const sep of [' \u2014 ', ' - ', ': ']) {
    const i = window.indexOf(sep, 16);
    if (i > 0) return { end: i, skip: sep.length };
  }
  return null;
}

/**
 * A prompt as a heading plus its description. The heading is only ever a
 * whole thought: a short prompt whole, else its first sentence or titled
 * clause (never more than `MAX_LEAD` characters). Everything after it, line
 * breaks included, is the description. A long run with nothing to cut at has
 * no heading at all: the whole text is the description, so a long question
 * never becomes a giant title and is never cut mid-sentence.
 */
export function splitLead(raw: string): { lead: string; rest: string } {
  const text = raw.trim();
  const nl = text.indexOf('\n');
  const first = (nl >= 0 ? text.slice(0, nl) : text).trim();
  const after = nl >= 0 ? text.slice(nl + 1).trim() : '';
  const cut = sentenceEnd(first) ?? (first.length > WHOLE_LEAD ? clauseEnd(first) : null);
  if (cut) {
    const tail = first.slice(cut.end + cut.skip).trim();
    if (tail || after) return { lead: first.slice(0, cut.end).trim(), rest: [tail, after].filter(Boolean).join('\n') };
  }
  if (first.length <= WHOLE_LEAD) return { lead: first, rest: after };
  return { lead: '', rest: text };
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

/**
 * A control that owns Space (and Enter) when it has focus: a button, link,
 * disclosure summary, or an ARIA widget. A surface-wide Space shortcut must
 * leave these alone so the control activates instead of the shortcut firing.
 */
export function isInteractive(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  return !!el.closest('button, a[href], summary, select, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"]');
}

/** The product's ease, for every Fusion transition. */
export const EASE = [0.22, 1, 0.36, 1] as const;
