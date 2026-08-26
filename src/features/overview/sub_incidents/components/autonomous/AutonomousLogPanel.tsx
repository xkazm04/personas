// The autonomous log as it appears inside the inbox: a way back, then the
// trail itself. Separated from the inbox shell so the shell stays at
// orchestration altitude and this surface can grow its own chrome.

import { Inbox } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AutonomousLogTrail } from './AutonomousLogTrail';
import type { AutonomousLogProps } from './autonomousLogTypes';

export function AutonomousLogPanel({
  incidents, loading, onOpenIncident, onBack,
}: AutonomousLogProps & { onBack: () => void }) {
  const { t } = useTranslation();
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
      <AutonomousLogTrail incidents={incidents} loading={loading} onOpenIncident={onOpenIncident} />
    </div>
  );
}
