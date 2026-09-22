// The evidence well: one member's record, rendered through the cockpit
// widget registry on a 12-column grid.
//
// WHY A LOCAL GRID RATHER THAN AN EXTRACTED `<WidgetGrid>`:
// `CockpitPanel`'s cell is not forty lines of grid logic. It is grid logic
// PLUS `parseWidgetActions` and `<WidgetActionBar>` - Morning Director's
// enum-validated one-click actions. Lifting the cell wholesale would move
// home's action machinery into a shared primitive; lifting only the geometry
// would change the very cell that has to stay byte-for-byte. And the council
// must never render an action button on an evidence tile at all: the gate in
// the footer is the one door a decision goes through, and a second
// affordance inside the evidence would be a second door. So the registry,
// the row spans and the reveal cascade are shared - the cell is not.
import { useMemo } from 'react';

import type { CompanionCockpitWidget } from '@/api/companion';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { cockpitRowSpan, cockpitWidgetRegistry } from '@/features/home/sub_cockpit/widgetRegistry';
import { useTranslation } from '@/i18n/useTranslation';

import { composeEvidence, type EvidenceLabels } from './composeEvidence';
import type { Seat } from './runModel';

export function EvidenceWell({ seat, runId }: { seat: Seat; runId: string | null }) {
  const { t, tx } = useTranslation();
  const e = t.council.evidence;
  const tbl = t.council.table;
  const enter = useRevealTracker();

  const labels: EvidenceLabels = useMemo(
    () => ({
      metricTitle: e.metric_title,
      urlTitle: e.url_title,
      fileTitle: e.file_title,
      findingsTitle: e.findings_title,
      comparisonTitle: e.comparison_title,
      mediaTitle: e.media_title,
      severity: (severity: string) =>
        severity === 'high' ? tbl.severity_high : severity === 'med' ? tbl.severity_med : tbl.severity_low,
      rivalsSummary: seat.name === 'rivalry' ? e.comparison_title : undefined,
    }),
    [e, tbl, seat.name],
  );

  const widgets = useMemo(() => composeEvidence(seat, labels), [seat, labels]);

  if (widgets.length === 0) {
    return <p className="m-0 typo-body text-muted">{e.empty}</p>;
  }

  return (
    <div className="grid auto-rows-[180px] grid-cols-12 gap-3" data-testid="council-evidence-well">
      {widgets.map((w, i) => (
        <EvidenceCell key={w.id} widget={w} order={i} runId={runId} enter={enter} unknown={tx} />
      ))}
    </div>
  );
}

function EvidenceCell({
  widget,
  order,
  runId,
  enter,
  unknown,
}: {
  widget: CompanionCockpitWidget;
  order: number;
  runId: string | null;
  enter: { hasEntered: (id: string) => boolean; markEntered: (id: string) => void };
  unknown: ReturnType<typeof useTranslation>['tx'];
}) {
  const { t } = useTranslation();
  const span = Math.max(1, Math.min(12, widget.span ?? 6));
  const rowSpan = cockpitRowSpan(widget.kind);
  // Total lookup with an explicit unknown arm: a kind this build does not
  // hold renders a named tile, never an empty cell that reads as "no
  // evidence" (census `unverifiable-catalog-lookup`).
  const Component = cockpitWidgetRegistry[widget.kind];
  // The run id is the app's, never the composer's: only the app knows which
  // run is on screen, so the media widget cannot be pointed anywhere else.
  const config = widget.kind === 'council_media' ? { ...widget.config, runId } : widget.config;

  return (
    <RevealItem
      revealId={widget.id}
      order={order}
      hasEntered={enter.hasEntered}
      markEntered={enter.markEntered}
      style={{
        gridColumn: `span ${span} / span ${span}`,
        gridRow: `span ${rowSpan} / span ${rowSpan}`,
      }}
      className="min-h-0"
    >
      {Component ? (
        <Component title={widget.title} config={config} />
      ) : (
        <div className="flex h-full items-center justify-center rounded-card border border-status-error/30 bg-status-error/[0.06] p-4 typo-caption text-status-error">
          {unknown(t.overview.cockpit.unknown_widget, { kind: widget.kind })}
        </div>
      )}
    </RevealItem>
  );
}

export default EvidenceWell;
