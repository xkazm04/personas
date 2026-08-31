import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { CoreSection } from './CoreSection';
import { ResponsibilitiesSection } from './ResponsibilitiesSection';
import { BrainSection } from './BrainSection';

type LifeSubTab = 'core' | 'responsibilities' | 'brain';

/**
 * Life — the living-agent surface for one persona, three sub-surfaces:
 *   Core             — the operator-owned character (dials, prose, lists)
 *   Responsibilities — standing charters + the attention ledger
 *   Brain            — episodic record, self-model, proposal inbox
 */
export function LifeTab() {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const [subTab, setSubTab] = useState<LifeSubTab>('core');

  if (!selectedPersona) return null;
  const life = t.agents.life;

  return (
    <div className="space-y-4" data-testid="life-tab">
      <div className="max-w-md">
        <SegmentedTabs<LifeSubTab>
          tabs={[
            { id: 'core', label: life.sub_core },
            { id: 'responsibilities', label: life.sub_responsibilities },
            { id: 'brain', label: life.sub_brain },
          ]}
          activeTab={subTab}
          onTabChange={setSubTab}
          ariaLabel={t.agents.editor_ui.tab_life}
          idPrefix="life"
          size="sm"
        />
      </div>
      <div role="tabpanel" id={`life-panel-${subTab}`} aria-labelledby={`life-tab-${subTab}`}>
        {subTab === 'core' && <CoreSection persona={selectedPersona} />}
        {subTab === 'responsibilities' && <ResponsibilitiesSection personaId={selectedPersona.id} />}
        {subTab === 'brain' && <BrainSection personaId={selectedPersona.id} />}
      </div>
    </div>
  );
}
