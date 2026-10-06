// The binding-state legend: shape plus colour per state, and the one sentence
// that explains the evidence dots. Its own file because two of the three
// layouts put it somewhere different and the third hides it.
import { bindingStateLabel } from '../../journey/journeyLabels';
import { LEGEND_STATES, STATE_CHIP } from '../../journey/journeyStyles';
import { useLifecycleViewModel } from '../context';

export function StateLegend({ align = 'center' }: { align?: 'center' | 'start' }) {
  const { dl } = useLifecycleViewModel();
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${align === 'center' ? 'justify-center' : ''}`}
      data-testid="lc-legend"
    >
      {LEGEND_STATES.map((s) => (
        <span key={s} className="flex items-center gap-1.5 typo-caption text-foreground">
          <span className={`w-3.5 h-3.5 rounded-interactive ${STATE_CHIP[s]}`} aria-hidden />
          {bindingStateLabel(dl, s)}
        </span>
      ))}
      <span className="typo-caption text-foreground">{dl.lc_legend_evidence}</span>
    </div>
  );
}
