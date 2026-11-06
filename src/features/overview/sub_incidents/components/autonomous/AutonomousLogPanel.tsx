// The autonomous log as it appears inside the inbox: a way back, then the
// register itself. Separated from the inbox shell so the shell stays at
// orchestration altitude and this surface can grow its own chrome.

import { Inbox } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { AutonomousLogRegister } from './AutonomousLogRegister';
import type { AutonomousLogProps } from './autonomousLogTypes';

export function AutonomousLogPanel({
  incidents, loading, failed, onRetry, onOpenIncident, onBack,
}: AutonomousLogProps & { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-center px-4 pb-2">
        <Button variant="secondary" size="sm" onClick={onBack} icon={<Inbox className="h-3.5 w-3.5" aria-hidden="true" />}>
{t.overview.incidents.ledger.back_to_inbox}
</Button>
      </div>
      <AutonomousLogRegister incidents={incidents} loading={loading} failed={failed} onRetry={onRetry} onOpenIncident={onOpenIncident} />
    </div>
  );
}
