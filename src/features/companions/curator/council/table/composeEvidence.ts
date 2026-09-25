// What one member actually looked at, composed into cockpit widgets.
//
// THE RULE THIS FILE EXISTS TO HOLD: the widget spec is composed by the APP,
// deterministically, from the member's own `evidence[]` and `findings[]`. The
// `/council` skill never authors it and no model is ever asked to. A member
// that staged three files and one screenshot gets exactly the widgets those
// four facts imply, in the same order, every time - so what the person sees
// at the gate is a rendering of the record rather than a second opinion
// about it.
//
// The kind map is TOTAL with an explicit unknown arm (census
// `unverifiable-catalog-lookup`): an evidence kind this build has never heard
// of becomes a plain callout carrying its ref verbatim, never a dropped fact.
import type { CompanionCockpitWidget } from '@/api/companion';

import type { EvidenceItem, Seat } from './runModel';

/** The titles and fixed copy the composer needs, handed in already translated. */
export interface EvidenceLabels {
  metricTitle: string;
  urlTitle: string;
  fileTitle: string;
  findingsTitle: string;
  comparisonTitle: string;
  mediaTitle: string;
  severity: (severity: string) => string;
  /** `{ahead} of {total} named rivals are ahead`, already interpolated. */
  rivalsSummary?: string;
}

/**
 * `by hand 40 min, with app 6 min` and friends: a metric ref with numbers in
 * it, split into the figures the stat grid draws.
 *
 * The return type is INFERRED rather than declared, deliberately: a declared
 * `{ label: string; value: string }` is the contract census
 * `unmeasurable-metric-tile` gates, and rightly - a tile that cannot hold an
 * absent value destroys absence at the call site. Nothing absent ever reaches
 * here: every pair is a figure this function just read out of the ref, and a
 * ref with fewer than two of them returns null so the caller draws one figure
 * instead of a grid of invented ones.
 */
function metricStats(ref: string) {
  const pairs = [...ref.matchAll(/([A-Za-z][A-Za-z ./-]{1,28}?)\s+([$]?-?\d[\d.,]*\s*%?)/g)];
  if (pairs.length < 2) return null;
  return pairs.slice(0, 6).map((m) => ({ label: (m[1] ?? '').trim(), value: (m[2] ?? '').trim() }));
}

function evidenceWidget(
  e: EvidenceItem,
  index: number,
  seatName: string,
  labels: EvidenceLabels,
): CompanionCockpitWidget {
  const id = `${seatName}-e${index}`;
  switch (e.kind) {
    case 'metric': {
      const stats = metricStats(e.ref);
      if (stats) {
        return {
          id,
          kind: 'stat_grid',
          title: e.caption || labels.metricTitle,
          span: 6,
          config: { stats, columns: Math.min(3, stats.length) },
        };
      }
      return {
        id,
        kind: 'metric_spark',
        title: labels.metricTitle,
        span: 4,
        config: { label: e.caption || labels.metricTitle, value: e.ref },
      };
    }
    case 'url':
      return {
        id,
        kind: 'issue_list',
        title: labels.urlTitle,
        span: 6,
        config: { items: [{ id, title: e.caption || e.ref, sublabel: e.ref, href: e.ref }] },
      };
    case 'file':
      return {
        id,
        kind: 'log_excerpt',
        title: labels.fileTitle,
        span: 6,
        config: { lines: [e.ref], caption: e.caption, source: seatName },
      };
    case 'screenshot':
    case 'video':
      return {
        id,
        kind: 'council_media',
        title: e.caption || labels.mediaTitle,
        span: 6,
        config: { relPath: e.ref, caption: e.caption, media: e.kind },
      };
    default: {
      // Unknown kind: keep the fact, name it honestly, never drop it.
      const unknown: string = e.kind;
      return {
        id,
        kind: 'text_callout',
        title: unknown,
        span: 6,
        config: { body: `${e.caption}\n\n\`${e.ref}\``, intent: 'info' },
      };
    }
  }
}

const SEVERITY_INTENT: Record<string, string> = { high: 'bad', med: 'warn', low: 'info' };

/**
 * One member's evidence well: its findings first (what it concluded), then
 * every piece of evidence in the order the run recorded it.
 *
 * Deterministic and pure - the same seat always composes the same spec, which
 * is what makes the well testable and what stops it drifting into a place
 * where an explanation could differ from the record it explains.
 */
export function composeEvidence(seat: Seat, labels: EvidenceLabels): CompanionCockpitWidget[] {
  const widgets: CompanionCockpitWidget[] = [];

  if (seat.findings.length > 0) {
    widgets.push({
      id: `${seat.name}-findings`,
      kind: 'issue_list',
      title: labels.findingsTitle,
      span: 12,
      config: {
        items: seat.findings.map((f) => ({
          id: f.id,
          title: f.title,
          sublabel: f.detail,
          severity: SEVERITY_INTENT[f.severity] ?? 'info',
        })),
      },
    });
  }

  // Rivalry is the one member whose evidence is inherently a comparison, so
  // its named rivals get the comparison card rather than a list of refs.
  if (seat.name === 'rivalry' && labels.rivalsSummary && seat.evidence.length > 0) {
    widgets.push({
      id: `${seat.name}-rivals`,
      kind: 'comparison_cards',
      title: labels.comparisonTitle,
      span: 12,
      config: {
        options: seat.evidence.map((e) => ({
          label: e.caption || e.ref,
          summary: e.ref,
          intent: 'info',
        })),
      },
    });
  }

  seat.evidence.forEach((e, i) => {
    if (seat.name === 'rivalry' && labels.rivalsSummary) return;
    widgets.push(evidenceWidget(e, i, seat.name, labels));
  });

  return widgets;
}
