// The Bay nameplate's second lamp (setting `lanes`): present only when the
// project has a mandate, lit amber only while that mandate holds a card for
// the operator (Breach, Sign or Accept). Calm is dark: a mandate whose steward
// is handling everything shows an unlit lamp, a project with no mandate none.

import { useMemo } from 'react';
import { cardsByProject } from '@/features/decision-center/lanes/laneModel';
import { useDecisionSurface, useLanesSnapshot } from '@/features/decision-center/lanes/useLanesSnapshot';
import { useTranslation } from '@/i18n/useTranslation';
import { Lamp } from '../parts';

export function MandateLamp({ projectId }: { projectId: string | null }) {
  const lanesOn = useDecisionSurface() === 'lanes';
  // Read-only: the command bar's lane counts keep the shared snapshot fresh.
  const { snapshot } = useLanesSnapshot(false);
  const { t, tx } = useTranslation();
  const cards = useMemo(() => cardsByProject(snapshot), [snapshot]);
  if (!lanesOn || !projectId || !snapshot) return null;
  if (!snapshot.charters.some((c) => c.projectId === projectId)) return null;
  const n = cards.get(projectId) ?? 0;
  return (
    <span data-testid="fleet-bay-mandate-lamp" data-cards={n} className="inline-flex flex-shrink-0">
      <Lamp
        lamp={{ tone: 'warn', lit: n > 0 }}
        label={n > 0 ? tx(t.monitor.ml_bay_lamp_cards, { count: n }) : t.monitor.ml_bay_lamp_calm}
      />
    </span>
  );
}
