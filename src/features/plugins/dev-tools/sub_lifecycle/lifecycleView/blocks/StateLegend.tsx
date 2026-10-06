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
 * The chips come from the shared ladder: a legend that disagreed with the marks
 * it explains would be a lie.
 */
import { bindingStateLabel } from '../../journey/journeyLabels';
import { LEGEND_STATES, STATE_CHIP } from '../../journey/journeyStyles';
import { useLifecycleViewModel } from '../context';

const WRAP = 'flex flex-wrap items-center justify-center gap-x-5 gap-y-2';

export function StateLegend() {
  const { dl } = useLifecycleViewModel();
  return (
    <div className={WRAP} data-testid="lc-legend">
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
