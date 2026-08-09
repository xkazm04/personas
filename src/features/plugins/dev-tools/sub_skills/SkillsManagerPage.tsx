// Skills Manager — Dev Tools' skills module: the workspace library and the
// active project's skills side by side, with the adopt/share Dev-runner
// machinery, transcript-mined usage, memory bindings and the Memory Ledger's
// per-skill context coverage (docs/plans/skill-memory-unification.md).
//
// Project selection = the app-wide ACTIVE PROJECT via the shared
// LifecycleProjectPicker (the same picker every dev-tools/teams page header
// uses), so switching here switches everywhere.
//
// This file is now page CHROME + tab routing only. Each tab is a self-contained
// surface — `SkillsOverviewPanel`, `SkillsAnalyticsTab`, `RegistryTab` — and the
// row/handler assembly lives in `useSkillsManagerRows`, so the Mastermind
// canvas's Skills modal mounts the very same components instead of maintaining
// a parallel skills UI.
import { useState } from 'react';

import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ImproveProvider } from '@/features/teams/sub_factory/passport/improve/ImproveContext';
import { useImproveEngine } from '@/features/teams/sub_factory/passport/improve/useImproveEngine';
import { usePassportData } from '@/features/teams/sub_factory/passport/usePassportData';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { Wand2 } from 'lucide-react';

import { DevToolsPageHeader } from '../DevToolsPageHeader';

import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { SkillsAnalyticsTab } from './analytics/SkillsAnalyticsTab';
import { RegistryTab } from './registry/RegistryTab';
import { SkillInfoModal } from './SkillInfoModal';
import { SkillsOverviewPanel } from './SkillsOverviewPanel';
import { useSkillsManagerRows } from './skillsManagerRows';
import { TraceTab } from './trace/TraceTab';

// Row models moved to `skillsManagerRows` (the hook that builds them) and are
// re-exported here so existing `from '../SkillsManagerPage'` type imports keep
// resolving.
export type { ProjRow, SkillsManagerVariantProps, WsRow } from './skillsManagerRows';

export default function SkillsManagerPage() {
  const { t } = useTranslation();
  // Same provider composition as Mastermind: passports feed the improve
  // engine, which owns the adopt/share Dev-runner ops the surfaces reuse.
  const { rawByProject, loading, reload } = usePassportData();
  const improve = useImproveEngine(rawByProject, reload);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);

  return (
    <ImproveProvider value={improve}>
      {loading && rawByProject.size === 0 ? (
        <div className="py-16"><LoadingSpinner label={t.plugins.dev_tools.skills_loading} /></div>
      ) : (
        <SkillsManagerInner key={activeProjectId ?? 'none'} activeId={activeProjectId} />
      )}
    </ImproveProvider>
  );
}

function SkillsManagerInner({ activeId }: { activeId: string | null }) {
  const { t } = useTranslation();
  const [pageTab, setPageTab] = useState<'overview' | 'analytics' | 'registry' | 'trace'>('overview');
  // Registry + Analytics share the page's info-modal slot; Overview owns its own
  // (it lives inside SkillsOverviewPanel, which the canvas modal mounts too).
  const [infoSkill, setInfoSkill] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="skills-manager-page">
      {/* unified module header — icon + title band, tabs inline, picker right */}
      <DevToolsPageHeader
        icon={Wand2}
        title={t.plugins.dev_tools.skills_title}
        actions={<LifecycleProjectPicker />}
      >
        <SegmentedTabs
          tabs={[
            { id: 'overview', label: t.plugins.dev_tools.skills_tab_overview },
            { id: 'analytics', label: t.plugins.dev_tools.skills_tab_analytics },
            { id: 'registry', label: 'Registry' },
            { id: 'trace', label: t.plugins.dev_tools.skills_tab_trace },
          ]}
          activeTab={pageTab}
          onTabChange={(v) => setPageTab(v as 'overview' | 'analytics' | 'registry' | 'trace')}
          variant="segment"
          size="sm"
          fullWidth={false}
          ariaLabel={t.plugins.dev_tools.skills_tab_aria}
        />
      </DevToolsPageHeader>

      <div className="flex-1 min-h-0 px-4 pb-4 pt-3">
        {pageTab === 'trace' ? (
          <TraceTab activeProjectId={activeId} onOpenInfo={setInfoSkill} />
        ) : pageTab === 'registry' ? (
          <RegistryTab activeProjectId={activeId} onOpenInfo={setInfoSkill} />
        ) : pageTab === 'analytics' && activeId ? (
          <AnalyticsHost projectId={activeId} onOpenInfo={setInfoSkill} />
        ) : (
          <SkillsOverviewPanel projectId={activeId} />
        )}
      </div>

      {infoSkill && (
        <SkillInfoModal skillName={infoSkill} projectId={activeId} onClose={() => setInfoSkill(null)} />
      )}
    </div>
  );
}

/** Analytics consumes the same project rows the Overview surface does — through
 *  the shared hook, not a second derivation. */
function AnalyticsHost({ projectId, onOpenInfo }: { projectId: string; onOpenInfo: (skill: string) => void }) {
  const rows = useSkillsManagerRows(projectId);
  return (
    <SkillsAnalyticsTab
      projectId={projectId}
      proj={rows.proj}
      totalContexts={rows.totalContexts}
      busy={rows.busy}
      onDispatch={rows.onDispatch}
      onOpenInfo={onOpenInfo}
    />
  );
}
