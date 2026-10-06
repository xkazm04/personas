/**
 * The up-to-eight outcome dots for a step, newest LAST. Its own file because the
 * dot row is a step's evidence pulse and every concept draws it somewhere.
 *
 * VISUAL FIX, 2026-10-06: the no-evidence case returned `<span className="h-1.5"
 * aria-hidden />`, an inline span with no content and no width - zero area, so a
 * step with no recorded evidence was shorter than its neighbours and the caption
 * row above it stopped aligning across the rail (Gate 2b: row rhythm). The row
 * always reserves the same box, whether or not it has dots in it.
 */
import { useTranslation } from '@/i18n/useTranslation';

import { outcomeLabel } from '../../journey/journeyLabels';
import { OUTCOME_DOT } from '../../journey/journeyStyles';
import type { JourneyNode } from '../../journey/journeyModel';

/** Reserved whatever the dot size is: the largest dot drawn is 8px. */
const ROW = 'flex h-2 items-center gap-1';
const DOT = 'w-1.5 h-1.5 rounded-full';

export function EvidenceDots({ node }: { node: JourneyNode }) {
  const { t, tx } = useTranslation();
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
          className={`${DOT} ${OUTCOME_DOT[d.outcome]}`}
        />
      ))}
    </span>
  );
}
