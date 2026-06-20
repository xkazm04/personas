/**
 * Chain Studio entry point.
 *
 * **Prototype mode (deep-merge):** a tab switcher A/Bs directional variants of
 * the *unified ledger* — one surface where the compose draft and the live
 * routing inventory (read + manage) coexist, so the separate "Routes" view can
 * be deleted with zero capability loss. `baseline` is the compose-only
 * Switchboard, kept as the untouched reference. The winner replaces this
 * switcher at consolidation. See docs/plans/studio-supersedes-builder.md.
 *
 * The export keeps its historical name so the lazy import in TriggersPage stays
 * stable.
 */
import { useState } from 'react';
import { Cable, GitBranch } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { StudioSwitchboard } from './StudioSwitchboard';
import { StudioPatchbayVariant } from './StudioPatchbayVariant';

type ProtoTab = 'patchbay' | 'baseline';

export function TriggerStudioCanvas() {
  const { t } = useTranslation();
  const st = t.triggers.studio;
  const [tab, setTab] = useState<ProtoTab>('patchbay');

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-2 border-b border-border flex-shrink-0">
        <SegmentedTabs<ProtoTab>
          tabs={[
            { id: 'patchbay', label: <><Cable className="w-3.5 h-3.5" />{st.proto_tab_patchbay}</>, ariaLabel: st.proto_tab_patchbay },
            { id: 'baseline', label: <><GitBranch className="w-3.5 h-3.5" />{st.proto_tab_baseline}</>, ariaLabel: st.proto_tab_baseline },
          ]}
          activeTab={tab}
          onTabChange={setTab}
          ariaLabel={t.triggers.tab_studio}
          fullWidth={false}
          size="sm"
        />
      </div>
      {tab === 'patchbay' && <StudioPatchbayVariant />}
      {tab === 'baseline' && <StudioSwitchboard />}
    </div>
  );
}
