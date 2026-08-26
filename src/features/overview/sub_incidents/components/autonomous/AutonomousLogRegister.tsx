// The autonomous log — "Register" (won the 2026-08-26 round-2 A/B over
// Timeline / Receipts and the round-1 Trail).
//
// Strategy: a STRICT register with a loud left-hand latency column. Every row
// is one line; the first column is the resume latency as a big green
// tabular numeral (the metric this log exists to show), then the source
// glyph tile, then the title at body weight given the whole remaining width,
// then agent in bold. The Raised / Resumed clocks were dropped at
// consolidation — the latency numeral already states their difference, and
// the width buys the title room it was losing to truncation. Header cells
// align over the same grid so columns scan top-to-bottom.

import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';
import { severityBadgeClass, sourceTableIcon, sourceTableLabel } from '../../libs/incidentTaxonomy';
import { resumeLatencyLabel, type AutonomousLogProps } from './autonomousLogTypes';
import { AutonomousLogFrame } from './autonomousLogShared';

const GRID = '64px 32px minmax(280px, 3fr) minmax(120px, 1fr) 28px';

export function AutonomousLogRegister(props: AutonomousLogProps) {
  const { t } = useTranslation();
  const l = t.overview.incidents.ledger;
  const H = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
    <span className={`typo-caption font-mono uppercase tracking-widest text-foreground ${right ? 'text-right' : ''}`}>{children}</span>
  );
  return (
    <AutonomousLogFrame
      {...props}
      dense
      rowHeight={40}
      header={
        <>
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/10">
            <ShieldCheck className="h-4 w-4 text-status-success" aria-hidden="true" />
            <h3 className="typo-heading text-foreground">{t.overview.incidents.noc_handled_title}</h3>
            <AthenaComposedBadge variant="handled" label={t.overview.incidents.noc_handled_by} />
          </div>
          <div className="sticky top-0 z-10 grid items-center gap-3 border-b border-primary/10 bg-background/95 px-4 py-1.5" style={{ gridTemplateColumns: GRID }} role="row">
            <H right>{l.col_resumed}</H><span /><H>{t.overview.incidents.col_incident}</H><H>{t.overview.incidents.filter_persona_label}</H><span />
          </div>
        </>
      }
      renderRow={(inc, index) => {
        const SourceIcon = sourceTableIcon(inc.sourceTable);
        const latency = resumeLatencyLabel(inc);
        return (
          <button type="button" onClick={() => props.onOpenIncident(inc)} style={{ gridTemplateColumns: GRID }}
            className={`group grid w-full items-center gap-3 border-b border-b-primary/[0.06] px-4 py-2 text-left transition-colors hover:bg-secondary/25 focus-ring ${index % 2 === 1 ? 'bg-primary/[0.02]' : ''}`}>
            <span className="text-right typo-data tabular-nums text-status-success">{latency ?? '—'}</span>
            <span className={`flex h-7 w-7 items-center justify-center rounded-card border ${severityBadgeClass(inc.severity)}`} title={sourceTableLabel(t, inc.sourceTable)}>
              <SourceIcon className="h-3.5 w-3.5" />
            </span>
            <span className="truncate typo-body text-foreground" title={inc.title}>{inc.title}</span>
            <span className="truncate typo-body font-semibold text-foreground">{inc.personaName ?? '—'}</span>
            <ArrowUpRight className="h-3.5 w-3.5 justify-self-end text-foreground/40 transition-colors group-hover:text-primary" aria-label={l.open_incident} />
          </button>
        );
      }}
    />
  );
}
