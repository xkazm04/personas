/**
 * The binding-state legend: the stroke ladder plus colour per state, and the one
 * sentence that explains the evidence dots. Its own file because the legend is
 * the key to the state marks' encoding and more than one concept renders it.
 *
 * The version this replaces rendered the five state NAMES and the explanatory
 * SENTENCE in the identical `typo-caption text-foreground` - so the key and its
 * footnote were one undifferentiated run of text, and the thing you came to the
 * legend to read had no more weight than the aside beside it (Gate 3, monotone).
 * The names are the small strong tier and the note sits one tier below them.
 *
 * Its chips were also 14px squares carrying a `border-[3px] border-double`, a
 * three-stroke border in 14 pixels; the shared ladder in `journeyStyles`
 * separates the five states on stroke style and width, and the chip is sized at
 * 16px so a 2px dash renders as more than one dash per side.
 *
 * `inline` lays the five states out as a row that centres under a figure;
 * `stacked` is the same key as a column, for a concept that keeps it in a
 * gutter. Nothing else varies: a legend that disagreed with the marks it
 * explains would be a lie, so the chips come from the shared ladder either way.
 */
import { bindingStateLabel } from '../../journey/journeyLabels';
import { LEGEND_STATES, STATE_CHIP } from '../../journey/journeyStyles';
import { useLifecycleViewModel } from '../context';

const WRAP = {
  inline: 'flex flex-wrap items-center justify-center gap-x-5 gap-y-2',
  stacked: 'flex flex-col items-start gap-1.5',
} as const;

export function StateLegend({ layout = 'inline' }: { layout?: keyof typeof WRAP }) {
  const { dl } = useLifecycleViewModel();
  return (
    <div className={WRAP[layout]} data-testid="lc-legend">
      {LEGEND_STATES.map((s) => (
        <span key={s} className="flex items-center gap-2 typo-label text-foreground">
          <span className={`shrink-0 w-4 h-4 rounded-interactive ${STATE_CHIP[s]}`} aria-hidden />
          {bindingStateLabel(dl, s)}
        </span>
      ))}
      <span className="typo-caption">{dl.lc_legend_evidence}</span>
    </div>
  );
}
