// The evidence well: one member's record, rendered through the cockpit
// widget registry as a stack of kit tiles (`Tiles cols={1}`).
//
// WHY NOT THE COCKPIT'S CELL:
// `CockpitPanel`'s cell hands each widget Morning Director's enum-validated
// one-click actions as its Tile footer. The council must never render an
// action button on an evidence tile at all: the gate in the footer is the
// one door a decision goes through, and a second affordance inside the
// evidence would be a second door. So the registry and the host/widget
// contract are shared; the cell is not, and it passes no footer.
import { useMemo } from 'react';

import type { CompanionCockpitWidget } from '@/api/companion';
import { KitHost, Tile, Tiles } from '@/features/shared/components/kit';
import { cockpitWidgetRegistry } from '@/features/home/sub_cockpit/widgetRegistry';
import { useTranslation } from '@/i18n/useTranslation';

import { composeEvidence, type EvidenceLabels } from './composeEvidence';
import type { Seat } from './runModel';

export function EvidenceWell({ seat, runId }: { seat: Seat; runId: string | null }) {
  const { t, tx } = useTranslation();
  const e = t.council.evidence;
  const tbl = t.council.table;

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

  // The findings are MemberReading's own section right above the well (the
  // FindingCards, with the weakest one highlighted); the composed findings
  // list drew them a second time, so the well shows only the evidence.
  const widgets = useMemo(
    () => composeEvidence(seat, labels).filter((w) => w.id !== `${seat.name}-findings`),
    [seat, labels],
  );

  if (widgets.length === 0) {
    return <p className="m-0 typo-body text-muted">{e.empty}</p>;
  }

  return (
    <KitHost compact testId="council-evidence-well">
      <Tiles label={tbl.evidence_heading} cols={1}>
        {widgets.map((w) => (
          <EvidenceCell key={w.id} widget={w} runId={runId} unknown={tx} />
        ))}
      </Tiles>
    </KitHost>
  );
}

function EvidenceCell({
  widget,
  runId,
  unknown,
}: {
  widget: CompanionCockpitWidget;
  runId: string | null;
  unknown: ReturnType<typeof useTranslation>['tx'];
}) {
  const { t } = useTranslation();
  // Total lookup with an explicit unknown arm: a kind this build does not
  // hold renders a named tile, never an empty cell that reads as "no
  // evidence" (census `unverifiable-catalog-lookup`).
  const Component = cockpitWidgetRegistry[widget.kind];
  // The run id is the app's, never the composer's: only the app knows which
  // run is on screen, so the media widget cannot be pointed anywhere else.
  const config = widget.kind === 'council_media' ? { ...widget.config, runId } : widget.config;

  if (!Component) {
    return <Tile error={{ title: unknown(t.overview.cockpit.unknown_widget, { kind: widget.kind }) }} />;
  }
  return <Component title={widget.title} config={config} />;
}

export default EvidenceWell;
