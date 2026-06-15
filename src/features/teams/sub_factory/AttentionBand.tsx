// D6 — attention-first top band for the Factory entry. The drill-down (projects
// → context×KPI matrix) is structural; a non-technical owner's first question is
// "what needs me?". This band answers it across ALL projects: the off-track
// (red) KPIs as chips that deep-link straight into that KPI's console (skipping
// the drill-down), plus an at-risk (yellow) count. When nothing's wrong it says
// so, so the entry always answers the question.
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import {
  STATUS_COLOR,
  groupKpis,
  kpiStatus,
  type MockKpi,
  type MockProject,
} from './factoryMock';

interface AttentionItem {
  projectId: string;
  projectName: string;
  groupId: string;
  kpi: MockKpi;
}

export function AttentionBand({
  projects,
  ed,
  onJump,
}: {
  projects: MockProject[];
  ed: (k: MockKpi) => MockKpi;
  /** Deep-link into a single KPI's console (L4), skipping the drill-down. */
  onJump: (projectId: string, groupId: string, kpiId: string) => void;
}) {
  const crit: AttentionItem[] = [];
  let warn = 0;
  for (const p of projects) {
    for (const g of p.groups) {
      for (const k of groupKpis(g)) {
        const st = kpiStatus(ed(k));
        if (st === 'crit') crit.push({ projectId: p.id, projectName: p.name, groupId: g.id, kpi: ed(k) });
        else if (st === 'warn') warn += 1;
      }
    }
  }

  if (crit.length === 0) {
    return (
      <div className="rounded-card border border-primary/10 bg-secondary/10 px-3 py-2 mb-3 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4" style={{ color: STATUS_COLOR.ok }} />
        <span className="typo-caption text-foreground">
          {warn > 0 ? `Nothing off track — ${warn} to keep an eye on.` : 'All KPIs on track.'}
        </span>
      </div>
    );
  }

  const shown = crit.slice(0, 8);
  const more = crit.length - shown.length;

  return (
    <div className="rounded-card border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-3 py-2 mb-3 flex items-center gap-2 flex-wrap">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: STATUS_COLOR.crit }} />
      <span className="typo-label text-foreground">Needs your attention</span>
      <span className="typo-caption">
        {crit.length} off track{warn > 0 ? ` · ${warn} at risk` : ''}
      </span>
      {shown.map((it) => (
        <button
          key={it.kpi.id}
          type="button"
          onClick={() => onJump(it.projectId, it.groupId, it.kpi.id)}
          className="typo-caption tabular-nums rounded-interactive border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 hover:bg-[var(--destructive)]/20 transition-colors px-2 py-0.5"
          title={`${it.kpi.name} — ${it.projectName}`}
        >
          <span className="font-medium">{it.kpi.name}</span>{' '}
          {it.kpi.current ?? '—'}/{it.kpi.target}{it.kpi.unit}
          <span className="opacity-60"> · {it.projectName}</span>
        </button>
      ))}
      {more > 0 && <span className="typo-caption opacity-70">+{more} more</span>}
    </div>
  );
}
