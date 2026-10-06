// The up-to-eight outcome dots drawn under a step in the rail, newest LAST.
// Lifted out of the retired `journey/JourneyTrack`; its own file because the
// dot row is the rail node's third line and every visual variant draws it.
import { useTranslation } from '@/i18n/useTranslation';

import { outcomeLabel } from '../../journey/journeyLabels';
import { OUTCOME_DOT } from '../../journey/journeyStyles';
import type { JourneyNode } from '../../journey/journeyModel';

export function EvidenceDots({ node }: { node: JourneyNode }) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  if (node.dots.length === 0) return <span className="h-1.5" aria-hidden />;
  const summary = node.dots
    .map((d) => tx(dl.lc_dot_label, { title: d.title, outcome: outcomeLabel(dl, d.outcome) }))
    .join('; ');
  return (
    <span role="img" aria-label={summary} className="flex items-center gap-1" data-testid={`lc-dots-${node.id}`}>
      {node.dots.map((d) => (
        <span
          key={`${d.sourceKind}:${d.sourceRef}`}
          data-outcome={d.outcome}
          className={`w-1.5 h-1.5 rounded-full ${OUTCOME_DOT[d.outcome]}`}
        />
      ))}
    </span>
  );
}
