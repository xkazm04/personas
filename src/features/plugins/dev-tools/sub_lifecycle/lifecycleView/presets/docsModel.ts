// Pure model behind the docs preset: the doc-rot rows grouped by status, worst
// first, a path split into its folder and its file, and the change log's join
// (evidence items that recorded a `docs` outcome). No React, no i18n, no IO.
// The estate (docs by folder) is `docs/estateModel.ts`.
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';

import { evidenceRowsFor, type EvidenceRow } from '../blocks/evidenceRows';

/** The doc-rot verdicts, worst first (`doc_status.status`). */
export const DOC_STATUSES = ['broken', 'stale', 'unverifiable', 'clean'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

/** Higher is worse: the order a folder, a group and a doc inside a folder are ranked by. */
export const DOC_SEVERITY: Record<DocStatus, number> = { broken: 3, stale: 2, unverifiable: 1, clean: 0 };

export interface DocGroup {
  status: DocStatus;
  docs: LifecycleDocRow[];
}

/** A row's status; an unknown one is reported as unverifiable: "could not be judged", never clean. */
export function asDocStatus(s: string): DocStatus {
  return (DOC_STATUSES as readonly string[]).includes(s) ? (s as DocStatus) : 'unverifiable';
}

/** Every non-empty group, worst first; docs inside a group by path. */
export function groupDocs(rows: LifecycleDocRow[]): DocGroup[] {
  return DOC_STATUSES.map((status) => ({
    status,
    docs: rows.filter((r) => asDocStatus(r.status) === status).sort((a, b) => a.docPath.localeCompare(b.docPath)),
  })).filter((g) => g.docs.length > 0);
}

/** The docs that are not clean right now: what the change modal can honestly say about the docs' state. */
export function docsNeedingWork(rows: LifecycleDocRow[]): LifecycleDocRow[] {
  return rows.filter((r) => asDocStatus(r.status) !== 'clean');
}

/** The broken and the stale docs' paths, broken first: what "Fix N docs" hands to Athena. */
export function docsToFix(rows: LifecycleDocRow[]): { broken: string[]; stale: string[] } {
  const of = (s: DocStatus) => rows.filter((r) => asDocStatus(r.status) === s).map((r) => r.docPath).sort();
  return { broken: of('broken'), stale: of('stale') };
}

/** "docs/features/vault.md" -> { dir: "docs/features/", name: "vault.md" }; a root file has an empty dir. */
export function splitDocPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? { dir: '', name: path } : { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) };
}

/** The change log: only the changes that recorded an outcome for `docs`. */
export function docsChangeLog(evidence: LifecycleEvidenceItem[]): EvidenceRow[] {
  return evidenceRowsFor('docs', evidence.filter((e) => e.outcomes.some((o) => o.stepId === 'docs')));
}
