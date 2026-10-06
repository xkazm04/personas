/**
 * CROSSCHECK's own derivation: the step order crossed with the evidence window.
 *
 * The shared model (`useLifecycleView`) already answers "which steps, in what
 * order, with what state" and "the evidence window". What it does not hold is
 * the JOIN of the two as a rectangle, because no previous container needed one:
 * the rail asks for one step's evidence at a time. This file is that rectangle
 * and nothing else, so it stays pure and the shared hook stays unforked.
 *
 * Column order is OLDEST FIRST, which is the reverse of the snapshot's
 * newest-first evidence array and the same convention as the evidence dots
 * (`lc_legend_evidence`: "newest on the right"). Two surfaces that disagreed
 * about which end is new would be worse than either.
 *
 * `observed` deliberately excludes `unknown`: a change that recorded nothing for
 * a step did not observe it, so counting it would inflate the denominator of a
 * ratio the operator reads as "how often this step actually held".
 */
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import type { JourneyNode } from '../../../journey/journeyModel';

export interface CrosscheckColumn {
  /** `${sourceKind}:${sourceRef}` - unique within one snapshot's window. */
  key: string;
  item: LifecycleEvidenceItem;
}

export interface CrosscheckRow {
  node: JourneyNode;
  /** One outcome per column, in column order. Never shorter than `columns`. */
  cells: LifecycleOutcome[];
  /** Changes that recorded an outcome for this step: done + skipped + failed. */
  observed: number;
  /** Of those, the ones that went through. */
  kept: number;
}

export interface CrosscheckMatrix {
  columns: CrosscheckColumn[];
  before: CrosscheckRow[];
  after: CrosscheckRow[];
  /** Both lanes in journey order: the sequence selection and the arrow keys walk. */
  rows: CrosscheckRow[];
}

const COUNTED: ReadonlySet<LifecycleOutcome> = new Set<LifecycleOutcome>(['done', 'skipped', 'failed']);

export function crosscheckMatrix(order: JourneyNode[], evidence: LifecycleEvidenceItem[]): CrosscheckMatrix {
  const columns: CrosscheckColumn[] = [...evidence]
    .reverse()
    .map((item) => ({ key: `${item.sourceKind}:${item.sourceRef}`, item }));

  const rows = order.map((node) => {
    const cells = columns.map((c) => c.item.outcomes.find((o) => o.stepId === node.id)?.outcome ?? 'unknown');
    return {
      node,
      cells,
      observed: cells.filter((c) => COUNTED.has(c)).length,
      kept: cells.filter((c) => c === 'done').length,
    };
  });

  return {
    columns,
    rows,
    before: rows.filter((r) => r.node.phase === 'before'),
    after: rows.filter((r) => r.node.phase === 'after'),
  };
}
