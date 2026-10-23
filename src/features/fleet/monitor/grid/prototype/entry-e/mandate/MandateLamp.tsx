// The Bay nameplate's mandate mark. Present only when the
// project has a mandate: a shield, amber while the mandate holds cards for the
// operator (Breach, Sign or Accept), dark when calm. A project with no mandate
// shows nothing. How many cards is in the bay's tooltip and the lane chips:
// a figure here cost the bay's name its last letters on a 1920 board.
//
// WHY NOT A SECOND LAMP (design pass, 2026-10-15). It was a lamp beside the
// bay's own lamp: on a real board two amber dots sat side by side on every
// asking bay and read as one fact said twice, with nothing to tell which was
// which. A shield is the mandate's mark; the lamp at the end stays the bay's.
// The sentence joins the bay's tooltip (`useMandateHint`).

import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cardsByProject } from '@/features/decision-center/lanes/laneModel';
import { useLanesSnapshot } from '@/features/decision-center/lanes/useLanesSnapshot';
import { useTranslation } from '@/i18n/useTranslation';

/** The operator's cards held by the project's mandate; null when no mandate. */
function useMandateCards(projectId: string | null): number | null {
  // Read-only: the command bar's lane counts keep the shared snapshot fresh.
  const { snapshot } = useLanesSnapshot(false);
  const cards = useMemo(() => cardsByProject(snapshot), [snapshot]);
  if (!projectId || !snapshot) return null;
  if (!snapshot.charters.some((c) => c.projectId === projectId)) return null;
  return cards.get(projectId) ?? 0;
}

/** The mandate's line for the bay's tooltip, or null. */
export function useMandateHint(projectId: string | null): string | null {
  const { t, tx } = useTranslation();
  const n = useMandateCards(projectId);
  if (n === null) return null;
  return n > 0 ? tx(t.monitor.ml_bay_lamp_cards, { count: n }) : t.monitor.ml_bay_lamp_calm;
}

export function MandateLamp({ projectId }: { projectId: string | null }) {
  const n = useMandateCards(projectId);
  const hint = useMandateHint(projectId);
  if (n === null) return null;
  return (
    <span
      role="img"
      aria-label={hint ?? undefined}
      data-testid="fleet-bay-mandate-lamp"
      data-cards={n}
      className={`inline-flex flex-shrink-0 ${n > 0 ? 'text-status-warning' : 'text-muted-foreground'}`}
    >
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
}
