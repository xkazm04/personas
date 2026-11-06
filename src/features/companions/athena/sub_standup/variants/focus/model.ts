/**
 * V2 "Focus" view helpers: what the queue counts as progress, the rail's mark
 * per state, and the one line Athena says over the queue. Pure, so the top
 * bar, the rail and the pane agree on one count.
 */
import type { Glyph, Tone } from '@/features/shared/components/kit';
import { isOpen } from '../../model/keymap';
import type { RowState, RowView, StandupView } from '../../model/types';

/** A segment of the progress bar: one per counted line, in queue order. */
export type SegTone = 'open' | 'decided' | 'skipped' | 'running' | 'done';

export interface Progress {
  done: number;
  total: number;
  running: number;
  open: number;
  segs: Array<{ key: string; tone: SegTone }>;
}

const PLANNED: readonly RowState[] = ['decided', 'running', 'done'];

/** A line that takes a decision at this standup (not an ask, not filler, not held elsewhere). */
function counted(row: RowView, view: StandupView): boolean {
  if (!row.itemId || row.kind === 'hold' || row.kind === 'filler' || row.state === 'refused') return false;
  return view.life === 'decide' ? true : PLANNED.includes(row.state);
}

export function progressOf(view: StandupView): Progress {
  const rows = view.rows.filter((r) => counted(r, view));
  const decide = view.life === 'decide';
  const segs = rows.map((r) => {
    let tone: SegTone;
    if (decide) tone = isOpen(r) ? 'open' : r.state === 'skipped' ? 'skipped' : 'decided';
    else tone = r.state === 'done' ? 'done' : r.state === 'running' ? 'running' : 'decided';
    return { key: r.key, tone };
  });
  const done = segs.filter((s) => (decide ? s.tone !== 'open' : s.tone === 'done')).length;
  return {
    done,
    total: segs.length,
    running: segs.filter((s) => s.tone === 'running').length,
    open: view.rows.filter(isOpen).length,
    segs,
  };
}

/** The status node a rail line carries on the spine: tone by meaning, glyph by certainty. */
export const MARK: Record<RowState, { tone: Tone; glyph: Glyph }> = {
  proposed: { tone: 'warning', glyph: 'hollow' },
  blank: { tone: 'neutral', glyph: 'hollow' },
  decided: { tone: 'primary', glyph: 'solid' },
  running: { tone: 'success', glyph: 'live' },
  done: { tone: 'success', glyph: 'soft' },
  skipped: { tone: 'neutral', glyph: 'empty' },
  waits: { tone: 'error', glyph: 'solid' },
  filler: { tone: 'neutral', glyph: 'soft' },
  refused: { tone: 'neutral', glyph: 'empty' },
};

/** Minutes a set of 0..1 blocks spans inside a window. */
export function blockMinutes(blocks: ReadonlyArray<{ start: number; end: number }>, span: number): number {
  return Math.round(blocks.reduce((m, b) => m + (b.end - b.start), 0) * span / 60_000);
}

/** Absolute time of a 0..1 position inside a window. */
export function atPos(p: number, w: { from: number; to: number }): number {
  return w.from + p * (w.to - w.from);
}
