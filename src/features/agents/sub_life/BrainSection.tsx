import { useState } from 'react';
import { Moon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { runPersonaConsolidationNow } from '@/api/agents/personaBrain';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { ProposalInbox } from './ProposalInbox';
import { BrainDashboard } from '@/features/agents/sub_brain/BrainDashboard';

/**
 * The Brain surface: the proposal inbox (the human gate), the abstracted
 * dashboard (memory, intake, consolidation yield, pressure/anomalies and
 * coverage — with the flat episode record demoted to a drill-down inside the
 * volume tile), and the manual consolidation trigger.
 *
 * The self-model is NOT rendered here: WP6 moved the manifest to its own tab,
 * and mounting it in Brain too would show the same document twice.
 */
export function BrainSection({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const addToast = useToastStore((s) => s.addToast);
  // Bumped when a proposal is applied so the dashboard remounts and refetches:
  // an approved memory-curation proposal changes the tier and category counts
  // the tiles just drew. (Its module cache means the remount paints warm, then
  // refreshes — no ghost flash.)
  const [dashboardEpoch, setDashboardEpoch] = useState(0);

  const consolidate = async () => {
    try {
      await runPersonaConsolidationNow(personaId);
      addToast(life.brain_consolidate_queued, 'success');
    } catch (err) {
      toastCatch('life:consolidateNow', life.save_failed)(err);
    }
  };

  return (
    <div className="space-y-4" data-testid="life-brain">
      <div className="flex justify-end">
        <AsyncButton
          size="sm"
          variant="secondary"
          icon={<Moon className="w-3.5 h-3.5" />}
          onClick={consolidate}
          data-testid="life-brain-consolidate"
        >
          {life.brain_consolidate}
        </AsyncButton>
      </div>
      <ProposalInbox
        personaId={personaId}
        onApplied={() => setDashboardEpoch((n) => n + 1)}
      />
      <BrainDashboard key={dashboardEpoch} personaId={personaId} />
    </div>
  );
}
