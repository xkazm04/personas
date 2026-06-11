// KPIs hub — the outcome layer above Goals (docs/plans/kpi-driven-orchestration.md P2).
// Two views behind a SegmentedTabs switch: the Dashboard (active KPIs as
// stat cards with trend + off-track tint) and the Proposals review queue
// (scan output drained via accept / adjust / reject). Header carries the
// shared project picker + the "Scan for KPIs" action.
import { useEffect, useMemo, useState } from 'react';
import { Activity, ScanSearch } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { LifecycleProjectPicker } from '@/features/plugins/dev-tools/sub_lifecycle/LifecycleProjectPicker';
import { KPIDashboard } from './KPIDashboard';
import { KPIProposalsQueue } from './KPIProposalsQueue';
import { KPIDetailDrawer } from './KPIDetailDrawer';
import { KPIExplainer } from './KPIExplainer';

type KpiView = 'dashboard' | 'proposals';

export default function KPIsPage() {
  const { t, tx } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const kpis = useSystemStore((s) => s.kpis);
  const kpisLoading = useSystemStore((s) => s.kpisLoading);
  const fetchAllKpis = useSystemStore((s) => s.fetchAllKpis);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const scanKpis = useSystemStore((s) => s.scanKpis);
  const evaluateDueKpis = useSystemStore((s) => s.evaluateDueKpis);

  const [view, setView] = useState<KpiView>('dashboard');
  const [openKpiId, setOpenKpiId] = useState<string | null>(null);

  useEffect(() => {
    // Cross-project scope: the dashboard charts + proposals table span every
    // project; the header picker only scopes the scan/evaluate actions.
    void fetchAllKpis();
    void fetchProjects();
  }, [fetchAllKpis, fetchProjects]);

  const proposedCount = useMemo(() => kpis.filter((k) => k.status === 'proposed').length, [kpis]);
  const openKpi = useMemo(() => kpis.find((k) => k.id === openKpiId) ?? null, [kpis, openKpiId]);

  const handleScan = async () => {
    if (!activeProjectId) return;
    try {
      await scanKpis(activeProjectId);
      // Proposals stream in as the scan runs; refresh when the user looks.
      setView('proposals');
    } catch (err) {
      toastCatch('kpi scan', t.kpis.scan_failed)(err);
    }
  };

  const handleEvaluateDue = async () => {
    if (!activeProjectId) return;
    try {
      const results = await evaluateDueKpis(activeProjectId);
      const n = Object.keys(results).length;
      // Surface as page hint via store error path is wrong for success — keep silent;
      // the dashboard re-renders with fresh values, which IS the feedback.
      void n;
    } catch (err) {
      toastCatch('kpi evaluate-due', t.kpis.evaluate_failed)(err);
    }
  };

  const viewTabs = [
    { id: 'dashboard' as KpiView, label: t.kpis.view_dashboard },
    {
      id: 'proposals' as KpiView,
      label: proposedCount > 0 ? `${t.kpis.view_proposals} (${proposedCount})` : t.kpis.view_proposals,
    },
  ];

  return (
    <ContentBox>
      <ContentHeader
        title={t.kpis.title}
        subtitle={t.kpis.subtitle}
        toolbar={
          <div className="flex items-center gap-2 flex-wrap">
            <SegmentedTabs<KpiView> tabs={viewTabs} activeTab={view} onTabChange={setView} ariaLabel={t.kpis.title} />
            <div className="flex-1" />
            <LifecycleProjectPicker />
            <AsyncButton
              size="sm"
              variant="secondary"
              icon={<Activity className="w-4 h-4" />}
              onClick={handleEvaluateDue}
              disabled={!activeProjectId}
              loadingText={t.kpis.measuring}
              data-testid="kpi-evaluate-due-button"
            >
              {t.kpis.evaluate_due_button}
            </AsyncButton>
            <AsyncButton
              size="sm"
              variant="secondary"
              icon={<ScanSearch className="w-4 h-4" />}
              onClick={handleScan}
              disabled={!activeProjectId}
              data-testid="kpi-scan-button"
            >
              {t.kpis.scan_button}
            </AsyncButton>
          </div>
        }
      />
      <ContentBody>
        <KPIExplainer />
        {view === 'proposals' ? (
          <KPIProposalsQueue onRefresh={() => void fetchAllKpis()} />
        ) : (
          <KPIDashboard
            loading={kpisLoading}
            onOpen={(id) => setOpenKpiId(id)}
            onReviewProposals={() => setView('proposals')}
          />
        )}
        {openKpi && <KPIDetailDrawer kpi={openKpi} onClose={() => setOpenKpiId(null)} />}
        {proposedCount > 0 && view === 'dashboard' && (
          <p className="mt-4 typo-caption text-foreground">
            {tx(t.kpis.proposals_waiting_hint, { count: proposedCount })}
          </p>
        )}
      </ContentBody>
    </ContentBox>
  );
}
