// KPI proposals review queue (P5 round 2) — a SCALABLE one-row-per-proposal
// table: name, project, category, the measured baseline, the suggested
// target, and quick Accept/Reject actions. Everything textual (rationale,
// description, exact procedure, target adjustment) lives in the clickable
// row's detail modal — the table stays scannable at 50 proposals.
import { useMemo, useState } from 'react';
import { Cable, Check, X } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import Button from '@/features/shared/components/buttons/Button';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { categoryMeta } from './kpiMeta';
import { KPIProposalModal } from './KPIProposalModal';
import { KPIConnectWizard } from './KPIConnectWizard';

export function KPIProposalsQueue({ onRefresh }: { onRefresh: () => void }) {
  const { t, tx } = useTranslation();
  const kpis = useSystemStore((s) => s.kpis);
  const projects = useSystemStore((s) => s.projects);
  const updateKpi = useSystemStore((s) => s.updateKpi);

  const [openId, setOpenId] = useState<string | null>(null);
  const [connectId, setConnectId] = useState<string | null>(null);

  const proposals = useMemo(() => kpis.filter((k) => k.status === 'proposed'), [kpis]);
  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return (id: string) => m.get(id) ?? '—';
  }, [projects]);
  const openKpi = useMemo(() => proposals.find((k) => k.id === openId) ?? null, [proposals, openId]);
  const connectKpi = useMemo(
    () => proposals.find((k) => k.id === connectId) ?? null,
    [proposals, connectId],
  );

  if (proposals.length === 0) {
    return (
      <EmptyState
        title={t.kpis.queue_empty_title}
        description={t.kpis.queue_empty_hint}
        action={{ label: t.kpis.queue_refresh, onClick: onRefresh }}
      />
    );
  }

  const quickAccept = (kpi: DevKpi) =>
    updateKpi(kpi.id, { status: 'active' }).catch(toastCatch('kpi accept', t.kpis.accept_failed));
  const quickReject = (kpi: DevKpi) =>
    updateKpi(kpi.id, { status: 'archived' }).catch(toastCatch('kpi reject', t.kpis.reject_failed));

  return (
    <div data-testid="kpi-proposals-queue">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-primary/15 text-left">
            <th className="typo-overline text-foreground py-2 pr-3">{t.kpis.col_kpi}</th>
            <th className="typo-overline text-foreground py-2 pr-3 hidden md:table-cell">
              {t.kpis.col_project}
            </th>
            <th className="typo-overline text-foreground py-2 pr-3 text-right">{t.kpis.col_baseline}</th>
            <th className="typo-overline text-foreground py-2 pr-3 text-right">{t.kpis.col_target}</th>
            <th className="typo-overline text-foreground py-2 pr-3 w-px whitespace-nowrap" aria-label={t.kpis.col_actions} />
          </tr>
        </thead>
        <tbody>
          {proposals.map((kpi) => {
            const cat = categoryMeta(kpi.category);
            const CatIcon = cat.icon;
            return (
              <tr
                key={kpi.id}
                onClick={() => setOpenId(kpi.id)}
                className="border-b border-primary/10 hover:bg-secondary/30 cursor-pointer transition-colors"
                data-testid={`kpi-proposal-${kpi.id}`}
              >
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Tooltip content={cat.label(t)}>
                      <CatIcon className="w-4 h-4 text-foreground flex-shrink-0" aria-label={cat.label(t)} />
                    </Tooltip>
                    <span className="typo-body text-foreground font-medium truncate">{kpi.name}</span>
                    {kpi.needed_connector && (
                      <Tooltip content={tx(t.kpis.connect_tooltip, { service: kpi.needed_connector })}>
                        <span
                          role="link"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConnectId(kpi.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              setConnectId(kpi.id);
                            }
                          }}
                          className="inline-flex items-center gap-1 typo-caption text-primary flex-shrink-0 cursor-pointer hover:underline"
                          data-testid={`kpi-proposal-connect-${kpi.id}`}
                        >
                          <Cable className="w-3 h-3" />
                          {kpi.needed_connector}
                        </span>
                      </Tooltip>
                    )}
                  </div>
                </td>
                <td className="py-2 pr-3 typo-caption text-foreground hidden md:table-cell">
                  {projectName(kpi.project_id)}
                </td>
                <td className="py-2 pr-3 typo-body text-foreground tabular-nums text-right">
                  {kpi.baseline_value != null ? (
                    <>
                      <Numeric value={kpi.baseline_value} /> {kpi.unit}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="py-2 pr-3 typo-body text-foreground tabular-nums text-right">
                  {kpi.target_value != null ? (
                    <>
                      <Numeric value={kpi.target_value} /> {kpi.unit}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1 justify-end">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      icon={<X className="w-3.5 h-3.5" />}
                      onClick={() => void quickReject(kpi)}
                      aria-label={t.kpis.reject_button}
                      title={t.kpis.reject_button}
                      data-testid={`kpi-reject-${kpi.id}`}
                    />
                    <Button
                      size="icon-sm"
                      variant="secondary"
                      icon={<Check className="w-3.5 h-3.5" />}
                      onClick={() => void quickAccept(kpi)}
                      aria-label={t.kpis.accept_button}
                      title={t.kpis.accept_button}
                      data-testid={`kpi-accept-${kpi.id}`}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {openKpi && <KPIProposalModal kpi={openKpi} onClose={() => setOpenId(null)} />}
      {connectKpi && (
        <KPIConnectWizard kpi={connectKpi} onClose={() => setConnectId(null)} />
      )}
    </div>
  );
}
