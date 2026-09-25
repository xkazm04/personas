/**
 * The four inks, in one file, so no surface can invent a fifth or lose one.
 *
 * A count, a measured zero, an unknown and an unmeasurable are four facts. Here
 * they are four Tone x Glyph pairs from the kit's closed vocabulary, and each
 * one also differs in WORD, so the distinction survives colour-blindness, a
 * monochrome theme and a screenshot:
 *
 *   a count        neutral / solid   the value itself
 *   measured zero  neutral / hollow  an instrument ran and found none
 *   unknown        pending / empty   nobody has looked
 *   unmeasurable   warning / soft    it ran and had nothing to work from
 *
 * The queue and the plan both draw through this file: the queue for what the
 * pre-read pass knows about a resource, the plan for how many of his intakes
 * point at a bundle. That is why the two columns can be read as one workflow -
 * they are telling the same four facts about the same material.
 */
import type { ReactNode } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Dot } from '@/features/shared/components/kit';
import type { Glyph, Tone } from '@/features/shared/components/kit';

import { useWords } from '../../../words';

export type InkKind = 'count' | 'measured-zero' | 'unknown' | 'unmeasurable';

export const INK: Record<InkKind, { tone: Tone; glyph: Glyph }> = {
  count: { tone: 'neutral', glyph: 'solid' },
  'measured-zero': { tone: 'neutral', glyph: 'hollow' },
  unknown: { tone: 'pending', glyph: 'empty' },
  unmeasurable: { tone: 'warning', glyph: 'soft' },
};

/** One fact: its ink, its words, and the sentence behind it. */
export function Fact({ kind, children, tip, mono }: {
  kind: InkKind;
  children: ReactNode;
  tip: string;
  mono?: boolean;
}) {
  const { tone, glyph } = INK[kind];
  return (
    <Tooltip content={tip}>
      <span className="cb-fact" data-ink={kind}>
        <Dot tone={tone} glyph={glyph} />
        <span className={mono ? 'typo-code k-ellipsis' : 'typo-caption k-ellipsis'}>{children}</span>
      </span>
    </Tooltip>
  );
}

/**
 * The legend. Four entries, not three: the page's argument is that a measured
 * quantity is one of four facts, and a legend that listed only the three empty
 * ones would imply the fourth needs no naming.
 */
export function FourFacts() {
  const { w } = useWords();
  return (
    <div className="k-legend-row k-in typo-caption">
      {/* i18n: "a count" has no key; the other three are the shipped legend words. */}
      <span><Dot {...INK.count} /> a count</span>
      <span><Dot {...INK['measured-zero']} /> {w.legend_measured_nothing}</span>
      <span><Dot {...INK.unknown} /> {w.legend_unknown}</span>
      <span><Dot {...INK.unmeasurable} /> {w.legend_unmeasurable}</span>
    </div>
  );
}
