// The autonomous log as it appears inside the inbox: a way back, then the
// log itself. Separated from the inbox shell so the shell stays at
// orchestration altitude and this surface can grow its own chrome.

import { Inbox } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AutonomousLogTrail } from './AutonomousLogTrail';
import { AutonomousLogTimeline } from './AutonomousLogTimeline';
import { AutonomousLogReceipts } from './AutonomousLogReceipts';
import { AutonomousLogRegister } from './AutonomousLogRegister';
import type { AutonomousLogProps } from './autonomousLogTypes';
import type { AutonomousVariant } from '../IncidentsVariantSwitch';

export function AutonomousLogPanel({
  incidents, loading, onOpenIncident, onBack, variant,
}: AutonomousLogProps & { onBack: () => void; variant: AutonomousVariant }) {
  const { t } = useTranslation();
  const logProps = { incidents, loading, onOpenIncident };
  return (
    <div>
      <div className="flex items-center px-4 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-card border border-primary/15 px-2.5 py-1 typo-caption text-foreground transition-colors hover:bg-secondary/40 focus-ring"
        >
          <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
          {t.overview.incidents.ledger.back_to_inbox}
        </button>
      </div>
      {/* PROTOTYPE SCAFFOLD (round 2) — the variant prop is removed at consolidation. */}
      {variant === 'timeline' ? <AutonomousLogTimeline {...logProps} />
        : variant === 'receipts' ? <AutonomousLogReceipts {...logProps} />
        : variant === 'register' ? <AutonomousLogRegister {...logProps} />
        : <AutonomousLogTrail {...logProps} />}
    </div>
  );
}
