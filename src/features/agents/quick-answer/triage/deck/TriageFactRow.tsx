// TriageFactRow — the docked ledger, compacted to ONE line.
//
// It was a two-to-three column grid, which on an idea card cost three rows of
// the card's height to say six things the reviewer mostly already knew: the
// project (now stamped in the header's corner), the category (now the icon on
// its own chip), and a derived "value" number that no verdict has ever turned
// on. The prose is what the decision is actually made from, so the height goes
// back to the prose.
//
// What is left reads as one line of `LABEL value` pairs. Overflow scrolls
// sideways rather than wrapping: a ledger that silently grows a second row is
// how the description loses its space again on the next card that carries eight
// facts.
import { memo } from 'react';

import type { TriageFact } from '../triageTypes';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { TONE_TEXT, toneReading } from './DeckChips';

/**
 * Fact ids whose value is a raw ISO timestamp rather than display text.
 *
 * `raised` is "how long has this been waiting". `lockedAt` is the persona
 * snapshot an evolution promotion is pinned to — the one fact on that card that
 * can make it undecidable — and it is only legible as an age.
 */
const TIME_FACTS = new Set(['raised', 'lockedAt']);

/**
 * Facts the card now says better somewhere else, or does not need to say.
 *
 *  • `project` — stamped in the header's top-right corner (`TriageCardHeader`).
 *  • `category` — already a chip, and now an iconned one.
 *  • `value` — a derived score, never the thing a verdict turns on; the meters
 *    it is derived FROM (impact / effort / risk) straddle the card's top edge.
 */
const SUPPRESSED = new Set(['project', 'category', 'value']);

/** Everything the row should actually render, in reading order. */
export function ledgerFacts(facts: readonly TriageFact[]): TriageFact[] {
  // Scores are already meters on the top edge; repeating them as text is noise.
  return facts.filter((f) => !f.score && !SUPPRESSED.has(f.id));
}

/** Memoised on `facts` — `item.facts`, the same array object per card. */
export const TriageFactRow = memo(function TriageFactRow({
  facts,
}: {
  facts: readonly TriageFact[];
}) {
  const { t } = useTranslation();
  const rendered = ledgerFacts(facts);
  if (rendered.length === 0) return null;

  return (
    <footer className="mt-4 shrink-0 border-t border-primary/10 pt-3">
      <dl className="flex items-baseline gap-x-6 overflow-x-auto whitespace-nowrap">
        {rendered.map((fact) => {
          // A fact's tone used to be `TONE_TEXT[fact.tone]` and NOTHING else, so
          // "Severity: critical" and "Team: platform" were the same string in
          // two colours. On the surface where a verdict is written, that is not
          // a cosmetic gap.
          const reading = toneReading(t, fact.tone);
          return (
            <div key={fact.id} className="flex min-w-0 items-baseline gap-1.5">
              <dt className="typo-label shrink-0 uppercase tracking-wide text-muted-foreground">
                {fact.label}
              </dt>
              <dd
                className={`typo-caption flex min-w-0 items-baseline gap-1 truncate ${fact.tone ? TONE_TEXT[fact.tone] : 'text-foreground'}`}
                title={fact.value}
              >
                {reading ? (
                  <reading.Icon className="h-3 w-3 shrink-0 self-center" aria-hidden />
                ) : null}
                {/* Timestamps arrive as raw ISO strings; the ledger is the one
                    place they're read as "how long has this been waiting". */}
                {TIME_FACTS.has(fact.id) ? <RelativeTime timestamp={fact.value} /> : fact.value}
                {/* The glyph is the sighted signal; this is the same fact for a
                    screen reader, which cannot see either the glyph or the hue. */}
                {reading ? <span className="sr-only">{reading.label}</span> : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </footer>
  );
});
