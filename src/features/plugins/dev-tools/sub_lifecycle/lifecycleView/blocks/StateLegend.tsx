/**
 * The binding-state legend: the stroke ladder plus colour per state, and the one
 * sentence that explains the evidence dots. Its own file because the legend is
 * the key to the rail's encoding and each visual variant renders that key
 * differently.
 *
 * VISUAL REBUILD, 2026-10-06. The version this replaces rendered the five state
 * NAMES and the explanatory SENTENCE in the identical `typo-caption
 * text-foreground` - so the key and its footnote were one undifferentiated run
 * of text, and the thing you came to the legend to read had no more weight than
 * the aside beside it (Gate 3, monotone). The names are now the small strong
 * tier and the note sits one tier below them, in every skin.
 *
 * Its chips were also 14px squares carrying a `border-[3px] border-double`, a
 * three-stroke border in 14 pixels; the shared ladder in `journeyStyles` now
 * separates the five states on stroke style and width, and the skin sizes the
 * chip at or above 16px so a 2px dash renders as more than one dash per side.
 */
import { bindingStateLabel } from '../../journey/journeyLabels';
import { LEGEND_STATES, STATE_CHIP } from '../../journey/journeyStyles';
import { useLifecycleViewModel } from '../context';
import { useSkin } from '../skins';

export function StateLegend() {
  const { dl } = useLifecycleViewModel();
  const skin = useSkin();
  return (
    <div className={skin.legendWrap} data-testid="lc-legend">
      {LEGEND_STATES.map((s) => (
        <span key={s} className={`flex items-center gap-2 ${skin.legendItem}`}>
          <span className={`shrink-0 ${skin.legendChip} ${STATE_CHIP[s]}`} aria-hidden />
          {bindingStateLabel(dl, s)}
        </span>
      ))}
      <span className={skin.legendNote}>{dl.lc_legend_evidence}</span>
    </div>
  );
}
