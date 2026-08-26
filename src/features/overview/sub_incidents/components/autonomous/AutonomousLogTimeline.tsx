// Prototype variant A — "Timeline"
//
// Strategy: the log is a TIME axis. A vertical spine runs down the left with
// a node per entry; the resumption time is the loudest element (big tabular
// numeral, the actual clock time), the latency-to-resume becomes a bracketed
// span drawn between "raised" and "resumed" so speed reads as geometry. The
// title is body-lg beside the node; source/agent are a quiet mono caption
// line. Answers "what happened, and when, and how fast" as a story.

import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';
import { sourceTableIcon, sourceTableLabel, severityShapeStatus } from '../../libs/incidentTaxonomy';
import { StatusShape } from '@/features/shared/components/display/StatusShape';
import { resumeLatencyLabel, type AutonomousLogProps } from './autonomousLogTypes';
import { AutonomousLogFrame, resumedAt } from './autonomousLogShared';

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function AutonomousLogTimeline(props: AutonomousLogProps) {
  const { t } = useTranslation();
  const l = t.overview.incidents.ledger;
  return (
    <AutonomousLogFrame
      {...props}
      rowHeight={64}
      rowsClassName="relative ml-6 border-l-2 border-primary/15 py-2"
      header={
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/10">
          <ShieldCheck className="h-4 w-4 text-status-success" aria-hidden="true" />
          <h3 className="typo-heading text-foreground">{t.overview.incidents.noc_handled_title}</h3>
          <AthenaComposedBadge variant="handled" label={t.overview.incidents.noc_handled_by} />
        </div>
      }
      renderRow={(inc) => {
        const SourceIcon = sourceTableIcon(inc.sourceTable);
        const latency = resumeLatencyLabel(inc);
        const when = resumedAt(inc);
        return (
          <button type="button" onClick={() => props.onOpenIncident(inc)}
            className="group relative flex w-full items-start gap-4 py-2.5 pl-6 pr-4 text-left transition-colors hover:bg-secondary/20 focus-ring">
            {/* Node on the spine */}
            <span className="absolute -left-[7px] top-4 flex h-3 w-3 items-center justify-center rounded-full border-2 border-background bg-status-success" aria-hidden="true" />
            {/* Time column — the loud element */}
            <span className="flex w-16 shrink-0 flex-col items-end">
              <span className="typo-data-lg tabular-nums leading-none text-foreground">{clock(when)}</span>
              {/* muted-ok: date sub-label under the clock numeral */}
              <span className="typo-caption text-foreground/55 tabular-nums">{day(when)}</span>
            </span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-2">
                <StatusShape status={severityShapeStatus(inc.severity)} size="sm" />
                <span className="typo-body-lg text-foreground truncate">{inc.title}</span>
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 typo-caption font-mono text-foreground/70">
                <span className="inline-flex items-center gap-1"><SourceIcon className="h-3 w-3" aria-hidden="true" />{sourceTableLabel(t, inc.sourceTable)}</span>
                <span>{inc.personaName ?? '—'}</span>
                <span className="inline-flex items-center gap-1">
                  {l.col_raised} <RelativeTime timestamp={inc.createdAt} />
                </span>
                {latency && (
                  <span className="inline-flex items-center gap-1 text-status-success">
                    <span aria-hidden="true">⟶</span>{latency}
                  </span>
                )}
              </span>
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-foreground/40 transition-colors group-hover:text-primary" aria-label={l.open_incident} />
          </button>
        );
      }}
    />
  );
}
