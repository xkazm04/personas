import { useState } from 'react';
import { Moon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { runPersonaConsolidationNow } from '@/api/agents/personaBrain';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { ProposalInbox } from './ProposalInbox';
import { IdentityPanel } from './IdentityPanel';
import { EpisodesTimeline } from './EpisodesTimeline';

/**
 * The Brain surface: proposal inbox (the human gate), the read-only
 * self-model, the episodic record, and the manual consolidation trigger.
 */
export function BrainSection({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const addToast = useToastStore((s) => s.addToast);
  // Bumped when a self-model proposal is applied so the IdentityPanel
  // remounts and refetches the freshly rewritten identity.md.
  const [identityEpoch, setIdentityEpoch] = useState(0);

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
        onApplied={(kind) => {
          if (kind === 'self_model_diff') setIdentityEpoch((n) => n + 1);
        }}
      />
      <IdentityPanel key={identityEpoch} personaId={personaId} />
      <EpisodesTimeline personaId={personaId} />
    </div>
  );
}
