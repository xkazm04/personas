/**
 * FOUR INKS. A count, a measured zero, an unknown and an unmeasurable are four
 * facts, and this file is the only place in the variant that draws any of them.
 *
 * They are told apart by SHAPE before colour, so they survive a light theme, a
 * dark theme and a reader who cannot separate two hues: a bare figure, a ring
 * beside a word, a dashed box, a hatched box. None of them is the character
 * `0`; the only `0` this variant can render is one `buildModel` measured.
 *
 * The same four inks serve BOTH columns. On the left they are what a channel
 * of the nine says; on the right they are what the pre-processing pass found
 * when it read an intake. That is deliberate - one vocabulary, so the reader
 * learns it once.
 */
import type { ReactNode } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';

import type { CellMark } from '../../../model/types';
import { EN } from './strings';
import { useWords } from '../../../words';

export type FactKind = 'value' | 'none' | 'unknown' | 'unmeasurable';

/** Which ink a ledger cell is drawn in. The mapping is the model's, not ours. */
export function inkOfCell(cell: CellMark): FactKind {
  switch (cell.kind) {
    case 'scored':
      return 'value';
    case 'measured-zero':
      return 'none';
    case 'unknown':
      return 'unknown';
    default:
      return 'unmeasurable';
  }
}

/**
 * One fact, in its own ink.
 *
 * `label` is the whole sentence a screen reader gets, because the visible word
 * is deliberately short and the difference between "nobody looked" and "there
 * is none" is the entire point of the surface.
 */
export function Fact({ kind, children, label }: { kind: FactKind; children?: ReactNode; label: string }) {
  if (kind === 'value') {
    return (
      <span className="typo-data k-regular v2b-fact v2b-fact--value" aria-label={label}>
        {children}
      </span>
    );
  }
  return (
    <span className={`typo-label k-regular v2b-fact v2b-fact--${kind}`} aria-label={label}>
      {children}
    </span>
  );
}

/** The short word each absent ink says. The long sentence lives in `label`. */
export function useInkWords(): Record<Exclude<FactKind, 'value'>, { word: string; say: string }> {
  const { w } = useWords();
  return {
    none: { word: EN.none, say: w.legend_measured_nothing_tip },
    unknown: { word: w.strip_unknown, say: w.legend_unknown_tip },
    unmeasurable: { word: EN.noBasis, say: w.legend_unmeasurable_tip },
  };
}

/** A non-scoring cell, drawn in its ink with its own sentence behind it. */
export function AbsentFact({ kind }: { kind: Exclude<FactKind, 'value'> }) {
  const ink = useInkWords()[kind];
  return (
    <Fact kind={kind} label={ink.say}>
      {ink.word}
    </Fact>
  );
}

/**
 * The four inks, named once, under the plan. It is a legend and not a tooltip
 * because the distinction it teaches is the page's argument: a reader who has
 * not met it cannot read a single row correctly.
 */
export function InkLegend() {
  const { w, tx } = useWords();
  const ink = useInkWords();
  const items: { kind: FactKind; word: ReactNode; say: string }[] = [
    { kind: 'value', word: <span className="typo-data k-regular">14</span>, say: tx(w.cell_scored, { detail: w.channel.c7, points: 56 }) },
    { kind: 'none', word: ink.none.word, say: ink.none.say },
    { kind: 'unknown', word: ink.unknown.word, say: ink.unknown.say },
    { kind: 'unmeasurable', word: ink.unmeasurable.word, say: ink.unmeasurable.say },
  ];
  // Each ink says its short word once and its MEANING once. The unknown ink's
  // shipped legend name is "unknown", which is also the word it prints, so the
  // meaning is spelled out instead of repeated.
  const names: Record<FactKind, string> = {
    value: EN.aCount,
    none: w.legend_measured_nothing,
    unknown: EN.nobodyLooked,
    unmeasurable: w.legend_unmeasurable,
  };
  return (
    <div className="v2b-legend k-legend-row typo-caption" aria-label={w.help_three_ways}>
      {items.map((it) => (
        <Tooltip key={it.kind} content={it.say} placement="top">
          <span className="v2b-legend__item">
            <Fact kind={it.kind} label={it.say}>
              {it.word}
            </Fact>
            <span>{names[it.kind]}</span>
          </span>
        </Tooltip>
      ))}
    </div>
  );
}
