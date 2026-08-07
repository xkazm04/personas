/**
 * Pure derivations for the remote-job history (Settings → Devices).
 *
 * The list is kept live by the `network:remote-job-updated` push rather than a
 * poll, which means the frontend has to merge single rows into a list it also
 * re-fetches. Every rule that decides HOW a pushed row lands lives here so it
 * can be tested without a store, a backend or React:
 *
 *  - a pushed row REPLACES the row with the same id, it never duplicates it;
 *  - a pushed row that is OLDER than the one already held is dropped, because
 *    Tauri events carry no ordering guarantee and a late `pending` must not
 *    overwrite the `completed` that already landed;
 *  - the merged list is always newest-first, so the table's default order is
 *    the same whether a row arrived by fetch or by event;
 *  - the list is capped, so a long-lived session cannot grow it without bound.
 */
import type { RemoteJob } from '@/lib/bindings/RemoteJob';
import type { RemoteJobDirection } from '@/lib/bindings/RemoteJobDirection';
import type { RemoteJobStatus } from '@/lib/bindings/RemoteJobStatus';

/**
 * Hard ceiling on rows held in memory. `list_remote_jobs` defaults to 100; the
 * extra headroom absorbs rows that arrive by event after the fetch settled.
 */
export const REMOTE_JOB_HISTORY_CAP = 200;

/** The direction filter offered above the table. `all` is the merged timeline. */
export type RemoteJobDirectionFilter = 'all' | RemoteJobDirection;

/** Statuses after which a job never changes again. */
const TERMINAL_STATUSES: ReadonlySet<RemoteJobStatus> = new Set<RemoteJobStatus>([
  'completed',
  'failed',
  'refused',
  'cancelled',
]);

/** True when the job has reached a status it will not leave. */
export function isTerminalRemoteJobStatus(status: RemoteJobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Compare two backend timestamps, newest first.
 *
 * Parses rather than comparing the strings: the rows are RFC 3339, but a
 * lexicographic compare silently mis-orders the moment two rows carry
 * different UTC offsets. Unparseable values sort last rather than throwing —
 * a malformed timestamp must not be able to hide a row.
 */
function compareIsoDesc(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return tb - ta;
}

/** Newest-first by `updatedAt`, tie-broken by `createdAt` then id (stable). */
export function sortRemoteJobsNewestFirst(jobs: readonly RemoteJob[]): RemoteJob[] {
  return [...jobs].sort(
    (a, b) =>
      compareIsoDesc(a.updatedAt, b.updatedAt) ||
      compareIsoDesc(a.createdAt, b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Merge one pushed row into the held list.
 *
 * Returns the SAME array reference when the push carries nothing new, so a
 * burst of redundant events cannot cause a re-render storm in the table.
 */
export function upsertRemoteJob(jobs: readonly RemoteJob[], incoming: RemoteJob): RemoteJob[] {
  const existing = jobs.find((job) => job.id === incoming.id);

  if (existing) {
    if (existing === incoming) return jobs as RemoteJob[];
    // Out-of-order delivery: a row we already hold at a newer revision wins.
    // Equal timestamps still take the incoming row — the same `updatedAt` with
    // a changed summary is a legitimate same-second update.
    if (compareIsoDesc(existing.updatedAt, incoming.updatedAt) < 0) return jobs as RemoteJob[];
  }

  const merged = existing
    ? jobs.map((job) => (job.id === incoming.id ? incoming : job))
    : [...jobs, incoming];

  return sortRemoteJobsNewestFirst(merged).slice(0, REMOTE_JOB_HISTORY_CAP);
}

/** Replace the whole list from a fetch: normalize order and apply the cap. */
export function replaceRemoteJobs(jobs: readonly RemoteJob[]): RemoteJob[] {
  return sortRemoteJobsNewestFirst(jobs).slice(0, REMOTE_JOB_HISTORY_CAP);
}

/** Narrow the timeline to one side of the exchange. */
export function selectJobsForDirection(
  jobs: readonly RemoteJob[],
  direction: RemoteJobDirectionFilter,
): RemoteJob[] {
  if (direction === 'all') return jobs as RemoteJob[];
  return jobs.filter((job) => job.direction === direction);
}
