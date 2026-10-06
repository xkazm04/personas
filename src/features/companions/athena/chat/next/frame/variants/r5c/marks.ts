/**
 * Folio's typographic vocabulary: footnote marks for what waits on you, a
 * shape per run state (never colour alone), and the one-line condensation of
 * her latest reply for the running line.
 */

import type { CompanionMessage } from '@/api/companion';
import type { useTranslation } from '@/i18n/useTranslation';
import { actionLabel, stripModelDirectives } from '../../../../../athenaLabels';
import type { ProcessMark } from '../../../useProcessColumns';
import type { WorkItem, WorkItemKind } from '../../../useWorkforce';
import { KIND_VAR } from '../../../tones';

/** The printer's sequence, then doubled (** †† ...), as a book does. */
const MARKS = ['*', '†', '‡', '§', '‖', '¶'] as const;

export function footnoteMark(index: number): string {
  const base = MARKS[index % MARKS.length]!;
  return base.repeat(Math.floor(index / MARKS.length) + 1);
}

/** A kind's ink. Approvals and plans read in the role ink for "you decide". */
export function kindInk(kind: WorkItemKind): string {
  return KIND_VAR[kind];
}

export type RunState = 'working' | 'needs' | 'stuck' | 'queued' | 'idle' | 'later';

export const RUN_INK: Record<RunState, string> = {
  working: 'var(--status-info)',
  needs: 'var(--status-warning)',
  stuck: 'var(--status-error)',
  queued: 'var(--status-neutral)',
  idle: 'var(--muted-dark)',
  later: 'var(--brand-purple)',
};

export function runState(p: ProcessMark): RunState {
  if (p.kind === 'schedule') return 'later';
  const s = p.state;
  if (s === 'awaiting_input' || s === 'waiting' || s === 'blocked') return 'needs';
  if (s === 'stale' || s === 'failed') return 'stuck';
  if (s === 'running' || s === 'spawning') return 'working';
  if (s === 'queued') return 'queued';
  return 'idle';
}

/** Worst first: what needs you, then what is stuck, then what moves. */
export const RUN_RANK: Record<RunState, number> = { needs: 0, stuck: 1, working: 2, queued: 3, later: 4, idle: 5 };

export function latestReply(messages: CompanionMessage[]): CompanionMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'assistant' && !m.content.trimStart().startsWith('PROGRESS:')) return m;
  }
  return null;
}

/** Markdown and ref links read as plain words. */
export function plainWords(markdown: string): string {
  return stripModelDirectives(markdown)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const LINE_MAX = 72;

/**
 * One whole sentence of her latest reply, or nothing: the running line never
 * prints a cut sentence. Her first sentence when it fits, else null and the
 * caller shows a label instead ("She answered").
 */
export function condensedLine(markdown: string): string | null {
  const text = plainWords(markdown);
  if (!text) return null;
  const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length <= LINE_MAX ? sentence : null;
}

/** Streaming text as it may be shown: directives out, a half-typed directive held back. */
export function writtenSoFar(raw: string): string {
  const lines = raw.split('\n');
  const last = lines[lines.length - 1] ?? '';
  // A trailing line that could still become `OP:` / `QR:` / `TTS:` / `PROGRESS:`.
  if (/^\s*(?:O|OP?|Q|QR?|T|TT|TTS?|P[A-Z]{0,7}|\{)$/.test(last)) lines.pop();
  return stripModelDirectives(lines.join('\n'));
}

/** The product's ease (`EASE_CURVE`), for every Folio transition. */
export const FOLIO_EASE = [0.22, 1, 0.36, 1] as const;

type T = ReturnType<typeof useTranslation>['t'];

/**
 * An item's name for the margin and the contents: an approval's action in
 * words, otherwise the first WHOLE sentence of its title (a nudge's message is
 * two sentences; the page reads the rest).
 */
export function itemTitle(t: T, item: WorkItem): string {
  if (item.kind === 'approval') return actionLabel(t, item.title);
  const text = plainWords(item.title);
  return text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
}

/** A footnote mark's flight between the margin and the folio's contents. */
export const FLIGHT = { layout: { duration: 0.5, ease: FOLIO_EASE } } as const;
export const STILL = { layout: { duration: 0 } } as const;
