// KPIs hub — the outcome layer above Goals (docs/plans/kpi-driven-orchestration.md P2).
// Two views behind a SegmentedTabs switch: the Dashboard (active KPIs as
// stat cards with trend + off-track tint) and the Proposals review queue
// (scan output drained via accept / adjust / reject). Header carries the
// shared project picker + the "Scan for KPIs" action.
import { useEffect, useMemo, useState } from 'react';
import { Activity, ScanSearch } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { LifecycleProjectPicker } from '@/features/plugins/dev-tools/sub_lifecycle/LifecycleProjectPicker';
import { KPIDashboard } from './KPIDashboard';
import { KPIProposalsQueue } from './KPIProposalsQueue';
import { KpiDetailModal } from './KpiDetailModal';

export default function KPIsPage() {
  const { t, tx } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const kpis = useSystemStore((s) => s.kpis);
  const kpisLoading = useSystemStore((s) => s.kpisLoading);
  const fetchAllKpis = useSystemStore((s) => s.fetchAllKpis);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const scanKpis = useSystemStore((s) => s.scanKpis);
  const evaluateDueKpis = useSystemStore((s) => s.evaluateDueKpis);
  // View selection lives in the sidebar (kpisTab) now, mirroring Goals.
  const kpisTab = useSystemStore((s) => s.kpisTab);
  const setKpisTab = useSystemStore((s) => s.setKpisTab);

  const [openKpiId, setOpenKpiId] = useState<string | null>(null);

  useEffect(() => {
    // Cross-project scope: the dashboard charts + proposals table span every
    // project; the header picker only scopes the scan/evaluate actions.
    void fetchAllKpis();
    void fetchProjects();
  }, [fetchAllKpis, fetchProjects]);

  const openKpi = useMemo(() => kpis.find((k) => k.id === openKpiId) ?? null, [kpis, openKpiId]);

  const handleScan = async () => {
    if (!activeProjectId) return;
    try {
      await scanKpis(activeProjectId);
      // Proposals stream in as the scan runs; jump to the proposals view.
      setKpisTab('proposals');
    } catch (err) {
      toastCatch('kpi scan', t.kpis.scan_failed)(err);
    }
  };

  const handleEvaluateDue = async () => {
    if (!activeProjectId) return;
    try {
      const results = await evaluateDueKpis(activeProjectId);
      // The results map carries a per-KPI outcome: a number (measured) or an
      // "error: …" string. Discarding it silently (the old `void n`) meant an
      // accepted KPI could be permanently unmeasurable — e.g. "Derived KPIs
      // need the project linked to a team" — with the user never told why
      // (2026-07-16 UAT major). Summarize both halves in one toast.
      const entries = Object.entries(results);
      const failures = entries.filter(([, v]) => typeof v === 'string' && v.startsWith('error'));
      const measured = entries.length - failures.length;
      if (failures.length > 0) {
        const detail = failures
          .map(([name, v]) => `${name}: ${String(v).replace(/^error:\s*/, '')}`)
          .join(' · ');
        useToastStore.getState().addToast(
          `${tx(t.kpis.evaluate_partial, { measured, failed: failures.length })} — ${detail}`,
          'error',
          8000,
        );
      } else if (measured > 0) {
        useToastStore.getState().addToast(
          tx(t.kpis.evaluate_measured, { count: measured }),
          'success',
          4000,
        );
      } else {
        useToastStore.getState().addToast(t.kpis.evaluate_none_due, 'success', 4000);
      }
    } catch (err) {
      toastCatch('kpi evaluate-due', t.kpis.evaluate_failed)(err);
    }
  };

  return (
    <ContentBox>
      <ContentHeader
        title={t.kpis.title}
        subtitle={t.kpis.subtitle}
        toolbar={
          <div className="flex items-center gap-2 flex-wrap">
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
        {kpisTab === 'proposals' ? (
          <KPIProposalsQueue onRefresh={() => void fetchAllKpis()} />
        ) : (
          <KPIDashboard
            loading={kpisLoading}
            onOpen={(id) => setOpenKpiId(id)}
            onReviewProposals={() => setKpisTab('proposals')}
          />
        )}
        {openKpi && <KpiDetailModal kpi={openKpi} onClose={() => setOpenKpiId(null)} />}
      </ContentBody>
    </ContentBox>
  );
}
