/**
 * lensAdapters - a lens-scan product as its Decision Center cards (spark
 * one-control, WP3): one `build`, `evidence` and `release` card per product,
 * each only while it is due (`lensKinds`).
 *
 * The words come in already translated (`decisionCenter.*`), like every
 * adapter here, so the model stays a plain function in a test. The cards
 * never write: their verbs are printed (and disabled) so the operator sees
 * what the sheet will ask, and their one gesture is Open. `payload` carries
 * what Open needs (the product, the kind) and the cost line.
 *
 * React-free.
 */
import type { LensScanProduct } from '@/lib/bindings/LensScanProduct';
import type { Translations } from '@/i18n/generated/types';
import type { TriageFact } from '@/features/agents/quick-answer/triage/triageTypes';

import type { DecisionItem } from '../model/decisionModel';
import { lensItemId, lensKindsOf, statusCounts, waitingRelease, type LensKind } from './lensKinds';
import { versionOfReleaseId, type ReleaseComposition } from './releaseComposition';

export type DecisionCenterCopy = Translations['decisionCenter'];
export type Interpolate = (template: string, vars: Record<string, string | number>) => string;

export interface LensCopy {
  dc: DecisionCenterCopy;
  tx: Interpolate;
  /** The deck's own skip verb (Later). */
  skip: string;
}

/** Mid-tier, as a backlog idea: above a report, under a held build. */
const LENS_WEIGHT = 50;

function plural(count: number, one: string, other: string, tx: Interpolate): string {
  return tx(count === 1 ? one : other, { count });
}

function storeFact(p: LensScanProduct, c: LensCopy): TriageFact {
  return { id: 'store', label: c.dc.lens.fact_store, value: c.tx(c.dc.lens.store_version, { version: p.storeVersion }) };
}

function base(kind: LensKind, p: LensScanProduct, c: LensCopy, title: string, body: string, facts: TriageFact[]): DecisionItem {
  const L = c.dc.lens;
  const evidence = kind === 'evidence';
  return {
    id: lensItemId(kind, p.projectId),
    sourceId: p.projectId,
    kind,
    title,
    body,
    tags: [],
    facts: [...facts, storeFact(p, c)],
    source: { label: p.name },
    createdAt: p.lastRunAt ?? '',
    weight: LENS_WEIGHT,
    branches: [],
    verdictLabels: {
      accept: evidence ? L.accept : L.approve,
      reject: evidence ? L.rework : L.decline,
      skip: c.skip,
    },
    payload: {
      projectId: p.projectId,
      lensKind: kind,
      cost: L.cost_open,
    },
  };
}

function buildCard(p: LensScanProduct, c: LensCopy): DecisionItem {
  const B = c.dc.build;
  const { proposed, approved, executing: building } = statusCounts(p);
  const lines = [
    proposed > 0 ? plural(proposed, B.body_proposed_one, B.body_proposed_other, c.tx) : null,
    approved > 0 ? plural(approved, B.body_approved_one, B.body_approved_other, c.tx) : null,
    B.body_open,
  ].filter((l): l is string => l !== null);
  const facts: TriageFact[] = [
    { id: 'proposed', label: B.fact_proposed, value: String(proposed) },
    { id: 'approved', label: B.fact_approved, value: String(approved) },
    ...(building > 0 ? [{ id: 'building', label: B.fact_building, value: String(building) }] : []),
  ];
  return base('build', p, c, c.tx(B.title, { product: p.name }), lines.join('\n\n'), facts);
}

function evidenceCard(p: LensScanProduct, c: LensCopy): DecisionItem {
  const E = c.dc.evidence;
  const body = [plural(p.awaitingTriage, E.body_one, E.body_other, c.tx), E.body_open].join('\n\n');
  const facts: TriageFact[] = [{ id: 'triage', label: E.fact_waiting, value: String(p.awaitingTriage) }];
  return base('evidence', p, c, c.tx(E.title, { product: p.name }), body, facts);
}

function statusWord(R: DecisionCenterCopy['release'], status: string): string {
  switch (status) {
    case 'draft': return R.status_draft;
    case 'building': return R.status_building;
    case 'pr-open': return R.status_pr_open;
    case 'merged': return R.status_merged;
    case 'failed': return R.status_failed;
    default: return status;
  }
}

function releaseCard(p: LensScanProduct, comp: ReleaseComposition | undefined, c: LensCopy): DecisionItem {
  const R = c.dc.release;
  const waiting = waitingRelease(p);
  // An open release names its version in its id; a suggestion needs the store (the composition).
  const version = (waiting ? versionOfReleaseId(waiting.id) : null) ?? comp?.version ?? null;
  const items = waiting ? comp?.items.length ?? null : p.unreleasedAccepted;
  const lines: string[] = [];
  if (waiting && version) lines.push(c.tx(waiting.status === 'pr-open' ? R.body_pr_open : R.body_merged, { version }));
  if (p.unreleasedAccepted > 0) lines.push(plural(p.unreleasedAccepted, R.body_items_one, R.body_items_other, c.tx));
  if (!waiting && version) lines.push(c.tx(R.body_version, { version }));
  lines.push(R.body_bp);
  const facts: TriageFact[] = [
    ...(version ? [{ id: 'version', label: R.fact_version, value: version }] : []),
    ...(items !== null ? [{ id: 'items', label: R.fact_items, value: String(items) }] : []),
    ...(waiting ? [{ id: 'status', label: R.fact_status, value: statusWord(R, waiting.status) }] : []),
  ];
  const title = version ? c.tx(R.title, { product: p.name, version }) : c.tx(R.title_next, { product: p.name });
  return base('release', p, c, title, lines.join('\n\n'), facts);
}

export { statusWord as releaseStatusWord };

/** Every due card of every product, in product order, then kind order. */
export function lensToDecisions(
  products: readonly LensScanProduct[],
  compositions: ReadonlyMap<string, ReleaseComposition>,
  c: LensCopy,
): DecisionItem[] {
  const out: DecisionItem[] = [];
  for (const p of products) {
    for (const kind of lensKindsOf(p)) {
      if (kind === 'build') out.push(buildCard(p, c));
      else if (kind === 'evidence') out.push(evidenceCard(p, c));
      else out.push(releaseCard(p, compositions.get(p.projectId), c));
    }
  }
  return out;
}
