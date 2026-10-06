/**
 * The up-to-eight outcome dots drawn under a step in the rail, newest LAST.
 * Lifted out of the retired `journey/JourneyTrack`; its own file because the dot
 * row is the rail node's third line and every visual variant draws it.
 *
 * VISUAL FIX, 2026-10-06: the no-evidence case returned `<span className="h-1.5"
 * aria-hidden />`, an inline span with no content and no width - zero area, so a
 * step with no recorded evidence was shorter than its neighbours and the caption
 * row above it stopped aligning across the rail (Gate 2b: row rhythm). The row
 * now always reserves the same box, whether or not it has dots in it.
 */
import { useTranslation } from '@/i18n/useTranslation';

import { outcomeLabel } from '../../journey/journeyLabels';
import { OUTCOME_DOT } from '../../journey/journeyStyles';
import type { JourneyNode } from '../../journey/journeyModel';
import { useSkin } from '../skins';

/** Reserved whatever the skin's dot size is: the largest dot any skin draws is 8px. */
const ROW = 'flex h-2 items-center gap-1';

export function EvidenceDots({ node }: { node: JourneyNode }) {
  const { t, tx } = useTranslation();
  const skin = useSkin();
  const dl = t.plugins.dev_lifecycle;

  if (node.dots.length === 0) return <span className={ROW} aria-hidden />;

  const summary = node.dots
    .map((d) => tx(dl.lc_dot_label, { title: d.title, outcome: outcomeLabel(dl, d.outcome) }))
    .join('; ');
  return (
    <span role="img" aria-label={summary} className={ROW} data-testid={`lc-dots-${node.id}`}>
      {node.dots.map((d) => (
        <span
          key={`${d.sourceKind}:${d.sourceRef}`}
          data-outcome={d.outcome}
          className={`${skin.dot} ${OUTCOME_DOT[d.outcome]}`}
        />
      ))}
    </span>
  );
}
