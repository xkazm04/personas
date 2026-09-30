import { useState } from 'react';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import CreateAthenaStage from './variants/CreateAthenaStage';
import CreateAthenaTable from './variants/CreateAthenaTable';
import { useCreateAthenaEngine } from './engine/useCreateAthenaEngine';

/**
 * Create Athena — the chat-driven onboarding wizard (Plugins → Companion →
 * Create Athena). One engine (`useCreateAthenaEngine`) drives the shell.
 *
 * Stage was chosen 2026-09-18 over the Conversation and Scenes prototypes
 * (vault Spark/ideas/athena-onboarding.md). Table is the Voice Studio v2
 * contest winner (2026-09-30), ported beside it behind this switch; Stage
 * stays the default until the owner accepts the port, then the switch and
 * the losing shell go (docs/concepts/athena-voice-studio-v2.md, phase 6).
 */
type Shell = 'stage' | 'table';

/**
 * The preview choice is transient session state (golden path
 * client-state-persistence: session state is not persisted): it survives
 * switching tabs in this session and resets to Stage on restart, which is
 * the default the owner asked for until the port is accepted.
 */
let sessionShell: Shell = 'stage';

export default function CreateAthenaPanel() {
  const { t } = useTranslation();
  const c = t.athena;
  const engine = useCreateAthenaEngine();
  const [shell, setShell] = useState<Shell>(sessionShell);
  const choose = (next: Shell) => {
    sessionShell = next;
    setShell(next);
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-2" data-testid="create-athena-panel" data-shell={shell}>
      <div className="flex justify-end">
        <SegmentedTabs<Shell>
          tabs={[
            { id: 'stage', label: c.table_shell_stage, testId: 'create-athena-shell-stage' },
            { id: 'table', label: c.table_shell_table, testId: 'create-athena-shell-table' },
          ]}
          activeTab={shell}
          onTabChange={choose}
          ariaLabel={c.table_shell_label}
          size="sm"
        />
      </div>
      <div className="flex-1 min-h-0">
        {shell === 'table' ? <CreateAthenaTable engine={engine} /> : <CreateAthenaStage engine={engine} />}
      </div>
    </div>
  );
}
