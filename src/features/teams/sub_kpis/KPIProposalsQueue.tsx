// KPI proposals review queue (P5 round 2) — a SCALABLE one-row-per-proposal
// ledger: name, project, the measured baseline, the suggested target, and
// quick Accept/Reject actions. Everything textual (rationale, description,
// exact procedure, target adjustment) lives in the clickable row's detail
// modal — the table stays scannable at 50 proposals. Rendered through
// UnifiedTable (sorting, keyboard nav, ghost-under-header cold load, one-shot
// row cascade) so it reads like every other ledger in the app, and scoped by
// the header picker's workspace / project.
import { useMemo, useState } from 'react';
import { Cable, Check, X } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import Button from '@/features/shared/components/buttons/Button';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { usePickerScope, inPickerScope } from '@/features/plugins/dev-tools/sub_workspaces/usePickerScope';
import { categoryMeta } from './kpiMeta';
import { KPIProposalModal } from './KPIProposalModal';
import { KPIConnectWizard } from './KPIConnectWizard';

const ROW_HEIGHT = 44;

function MeasureCell({ value, unit }: { value: number | null; unit: string }) {
  if (value == null) return <span className="typo-body text-foreground">—</span>;
  return (
    <span className="typo-body text-foreground tabular-nums whitespace-nowrap">
      <Numeric value={value} /> {unit}
    </span>
  );
}

export function KPIProposalsQueue({ onRefresh }: { onRefresh: () => void }) {
  const { t, tx } = useTranslation();
  const kpis = useSystemStore((s) => s.kpis);
  const kpisLoading = useSystemStore((s) => s.kpisLoading);
  const projects = useSystemStore((s) => s.projects);
  const updateKpi = useSystemStore((s) => s.updateKpi);
  const scope = usePickerScope();

  const [openId, setOpenId] = useState<string | null>(null);
  const [connectId, setConnectId] = useState<string | null>(null);

  const proposals = useMemo(
    () => kpis.filter((k) => k.status === 'proposed' && inPickerScope(scope, k.project_id)),
    [kpis, scope],
  );
  const projectName = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) ?? '—';
  }, [projects]);
  const openKpi = useMemo(() => proposals.find((k) => k.id === openId) ?? null, [proposals, openId]);
  const connectKpi = useMemo(() => proposals.find((k) => k.id === connectId) ?? null, [proposals, connectId]);

  const columns = useMemo<TableColumn<DevKpi>[]>(() => {
    const quickAccept = (kpi: DevKpi) =>
      updateKpi(kpi.id, { status: 'active' }).catch(toastCatch('kpi accept', t.kpis.accept_failed));
    const quickReject = (kpi: DevKpi) =>
      updateKpi(kpi.id, { status: 'archived' }).catch(toastCatch('kpi reject', t.kpis.reject_failed));
    const cols: TableColumn<DevKpi>[] = [
      {
        key: 'name',
        label: t.kpis.col_kpi,
        width: 'minmax(220px, 2fr)',
        sortable: true,
        sortFn: (a, b) => a.name.localeCompare(b.name),
        render: (kpi) => {
          const cat = categoryMeta(kpi.category);
          const CatIcon = cat.icon;
          return (
            <div className="flex items-center gap-2 min-w-0">
              <Tooltip content={cat.label(t)}>
                <CatIcon className="w-4 h-4 text-foreground flex-shrink-0" aria-label={cat.label(t)} />
              </Tooltip>
              <span className="typo-body text-foreground truncate">{kpi.name}</span>
              {kpi.needed_connector && (
                <Tooltip content={tx(t.kpis.connect_tooltip, { service: kpi.needed_connector })}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setConnectId(kpi.id); }}
                    className="inline-flex items-center gap-1 typo-caption text-primary flex-shrink-0 hover:underline"
                    data-testid={`kpi-proposal-connect-${kpi.id}`}
                  >
                    <Cable className="w-3 h-3" />
                    {kpi.needed_connector}
                  </button>
                </Tooltip>
              )}
            </div>
          );
        },
      },
    ];
    // A single-project scope makes the project column say the same thing on every row.
    if (scope.kind !== 'project') {
      cols.push({
        key: 'project',
        label: t.kpis.col_project,
        width: 'minmax(140px, 1fr)',
        sortable: true,
        sortFn: (a, b) => projectName(a.project_id).localeCompare(projectName(b.project_id)),
        render: (kpi) => <span className="typo-body text-foreground truncate block">{projectName(kpi.project_id)}</span>,
      });
    }
    cols.push(
      {
        key: 'baseline',
        label: t.kpis.col_baseline,
        width: '130px',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => (a.baseline_value ?? -Infinity) - (b.baseline_value ?? -Infinity),
        render: (kpi) => <MeasureCell value={kpi.baseline_value} unit={kpi.unit} />,
      },
      {
        key: 'target',
        label: t.kpis.col_target,
        width: '130px',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => (a.target_value ?? -Infinity) - (b.target_value ?? -Infinity),
        render: (kpi) => <MeasureCell value={kpi.target_value} unit={kpi.unit} />,
      },
      {
        key: 'actions',
        label: '',
        width: '96px',
        align: 'right',
        render: (kpi) => (
          <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
            <Tooltip content={t.kpis.reject_button}>
              <Button
                size="icon-sm"
                variant="ghost"
                icon={<X className="w-3.5 h-3.5" />}
                onClick={() => void quickReject(kpi)}
                aria-label={t.kpis.reject_button}
                data-testid={`kpi-reject-${kpi.id}`}
              />
            </Tooltip>
            <Tooltip content={t.kpis.accept_button}>
              <Button
                size="icon-sm"
                variant="secondary"
                icon={<Check className="w-3.5 h-3.5" />}
                onClick={() => void quickAccept(kpi)}
                aria-label={t.kpis.accept_button}
                data-testid={`kpi-accept-${kpi.id}`}
              />
            </Tooltip>
          </div>
        ),
      },
    );
    return cols;
  }, [t, tx, scope.kind, projectName, updateKpi]);

  // Settled and genuinely empty: the refresh-bearing empty state. While the
  // first fetch runs, UnifiedTable paints its ghost under the header instead.
  if (!kpisLoading && proposals.length === 0) {
    return (
      <EmptyState
        title={t.kpis.queue_empty_title}
        description={t.kpis.queue_empty_hint}
        action={{ label: t.kpis.queue_refresh, onClick: onRefresh }}
      />
    );
  }

  return (
    <div data-testid="kpi-proposals-queue">
      <UnifiedTable<DevKpi>
        columns={columns}
        data={proposals}
        getRowKey={(k) => k.id}
        onRowClick={(k) => setOpenId(k.id)}
        isLoading={kpisLoading}
        rowHeight={ROW_HEIGHT}
        className="max-h-[70vh]"
        tableId="kpi-proposals"
        ariaLabel={t.kpis.view_proposals}
        emptyTitle={t.kpis.queue_empty_title}
        rowReveal={{ resetKey: scope.key }}
      />
      {openKpi && <KPIProposalModal kpi={openKpi} onClose={() => setOpenId(null)} />}
      {connectKpi && <KPIConnectWizard kpi={connectKpi} onClose={() => setConnectId(null)} />}
    </div>
  );
}
