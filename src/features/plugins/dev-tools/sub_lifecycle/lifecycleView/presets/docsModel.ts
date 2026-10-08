// Pure model behind the docs preset: the doc-rot rows grouped by status, worst
// first, and the change log's join (evidence items that recorded a `docs`
// outcome). No React, no i18n, no IO.
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';

import { evidenceRowsFor, type EvidenceRow } from '../blocks/evidenceRows';

/** The doc-rot verdicts, worst first (`doc_status.status`). */
export const DOC_STATUSES = ['broken', 'stale', 'unverifiable', 'clean'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export interface DocGroup {
  status: DocStatus;
  docs: LifecycleDocRow[];
}

function asStatus(s: string): DocStatus {
  // An unknown status is reported as unverifiable: "could not be judged", never clean.
  return (DOC_STATUSES as readonly string[]).includes(s) ? (s as DocStatus) : 'unverifiable';
}

/** Every non-empty group, worst first; docs inside a group by path. */
export function groupDocs(rows: LifecycleDocRow[]): DocGroup[] {
  return DOC_STATUSES.map((status) => ({
    status,
    docs: rows.filter((r) => asStatus(r.status) === status).sort((a, b) => a.docPath.localeCompare(b.docPath)),
  })).filter((g) => g.docs.length > 0);
}

/** The docs that are not clean right now: what the change modal can honestly say about the docs' state. */
export function docsNeedingWork(rows: LifecycleDocRow[]): LifecycleDocRow[] {
  return rows.filter((r) => asStatus(r.status) !== 'clean');
}

/** The change log: only the changes that recorded an outcome for `docs`. */
export function docsChangeLog(evidence: LifecycleEvidenceItem[]): EvidenceRow[] {
  return evidenceRowsFor('docs', evidence.filter((e) => e.outcomes.some((o) => o.stepId === 'docs')));
}
