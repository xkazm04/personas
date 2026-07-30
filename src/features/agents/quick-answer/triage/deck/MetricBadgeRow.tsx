// MetricBadgeRow — the score facts, straddling the card's top edge.
//
// The badges deliberately sit OUTSIDE the card's `overflow-hidden` body,
// half-above its border. Two reasons: the numbers a reviewer weighs (impact,
// effort, risk, confidence) stay legible while the card's own content scrolls,
// and the row visually pins the card to the stack — a hard edge broken by
// floating chips reads as an object, not a rectangle.
//
// Only `facts` carrying a `score` appear here; the rest of the ledger belongs
// in the card body. Colour comes from `bandTone`, which honours `invert`, so
// "Effort 2" is green and "Risk 9" is red without this file naming either.
import type { TriageFact } from '../triageTypes';
import { bandTone, TONE_BORDER, TONE_FILL, TONE_TEXT } from './DeckChips';

function MetricBadge({ fact }: { fact: TriageFact }) {
  const score = fact.score;
  if (!score) return null;

  const tone = bandTone(score.value, score.max, score.invert);
  const span = score.max > 0 ? score.max : 1;
  const pct = Math.min(100, Math.max(0, (score.value / span) * 100));

  return (
    <div
      className={`flex items-center gap-2 rounded-pill border bg-background px-3 py-1.5 shadow-elevation-2 ${TONE_BORDER[tone]}`}
    >
      <span className="typo-label text-foreground">{fact.label}</span>
      <span className={`typo-data font-semibold tabular-nums ${TONE_TEXT[tone]}`}>{fact.value}</span>
      <span className="relative block h-1 w-7 overflow-hidden rounded-pill bg-primary/15" aria-hidden>
        <span
          className={`absolute inset-y-0 left-0 rounded-pill ${TONE_FILL[tone]}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

export function MetricBadgeRow({ facts }: { facts: TriageFact[] }) {
  const scored = facts.filter((f) => f.score);
  if (scored.length === 0) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-0 z-50 flex max-w-full -translate-x-1/2 -translate-y-1/2 flex-nowrap items-center gap-2 px-3">
      {scored.map((fact) => (
        <MetricBadge key={fact.id} fact={fact} />
      ))}
    </div>
  );
}
