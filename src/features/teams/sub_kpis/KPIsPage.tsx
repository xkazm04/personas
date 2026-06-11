// KPIs hub — the outcome layer above Goals (docs/plans/kpi-driven-orchestration.md P2).
// Two views behind a SegmentedTabs switch: the Dashboard (active KPIs as
// stat cards with trend + off-track tint) and the Proposals review queue
// (scan output drained via accept / adjust / reject). Header carries the
// shared project picker + the "Scan for KPIs" action.
import { useEffect, useMemo, useState } from 'react';
import { ScanSearch } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { LifecycleProjectPicker } from '@/features/plugins/dev-tools/sub_lifecycle/LifecycleProjectPicker';
import { KPIDashboard } from './KPIDashboard';
import { KPIProposalsQueue } from './KPIProposalsQueue';
import { KPIDetailDrawer } from './KPIDetailDrawer';

type KpiView = 'dashboard' | 'proposals';

export default function KPIsPage() {
  const { t, tx } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const kpis = useSystemStore((s) => s.kpis);
  const kpisLoading = useSystemStore((s) => s.kpisLoading);
  const fetchKpis = useSystemStore((s) => s.fetchKpis);
  const scanKpis = useSystemStore((s) => s.scanKpis);

  const [view, setView] = useState<KpiView>('dashboard');
  const [openKpiId, setOpenKpiId] = useState<string | null>(null);

  useEffect(() => {
    if (activeProjectId) void fetchKpis(activeProjectId);
  }, [activeProjectId, fetchKpis]);

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
        {!activeProjectId ? (
          <EmptyState title={t.kpis.no_project_title} description={t.kpis.no_project_hint} />
        ) : view === 'proposals' ? (
          <KPIProposalsQueue onRefresh={() => void fetchKpis(activeProjectId)} />
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
