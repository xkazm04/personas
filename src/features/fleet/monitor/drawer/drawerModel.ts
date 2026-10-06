// drawerModel — the ONE view model all three drawer readings render.
//
// The three variants differ in COMPOSITION, not in data: each one takes this
// model and decides what the operator looks at first. Keeping the model here
// is what stops a variant from quietly growing its own fetch, its own sort or
// its own idea of how many reviews are pending — the defect that makes a set
// of "variants" three different features wearing one name.

import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { PersonaCapability } from '@/lib/personas/capabilities';
import type { MonitorReviewItem } from '../useMonitorData';
import {
  SEVERITY_META, severityBucket,
  type DrawerSection, type PersonaCardModel, type ProcessEntry, type SeverityBucket,
} from '../monitorModel';

export interface DrawerModel {
  card: PersonaCardModel;
  /** Severity-ordered: critical first. */
  reviews: MonitorReviewItem[];
  /** Newest first. */
  messages: PersonaReport[];
  /** Waiting-first: input_required, draft_ready, running, queued. */
  processes: ProcessEntry[];
  useCases: PersonaCapability[];
  /** Badge depth per section — the MAX of the fetched page and the card's
   *  GROUP BY count, so a slow page never reads as "nothing pending". */
  counts: Record<DrawerSection, number>;
  /** The first page is still in flight. */
  loading: boolean;
  /** Monotonic clock from the Monitor, for live elapsed timers. */
  now: number;
  /** Narrow query onto the per-review in-flight ledger — never a drawer-wide flag. */
  isReviewInFlight: (id: string, intent?: string) => boolean;
  /** True while ANY write is in flight. PRESENTATIONAL ONLY (`aria-busy`). */
  isProcessing: boolean;
  onReviewAction: (id: string, status: ManualReviewStatus, notes?: string) => void | Promise<void>;
  onDispatchAction: (id: string, action: string) => void | Promise<void>;
  onMarkRead: (id: string) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// The merged worklist — the `queue` reading
// ---------------------------------------------------------------------------

/**
 * One thing waiting on the operator, whatever kind it is. The queue variant's
 * whole claim is that a drawer organised by SOURCE (reviews here, reports
 * there, processes in a third tab) makes the operator do the merge in their
 * head; this type is the merge, done once.
 */
export type WorkItem =
  | { key: string; rank: number; kind: 'review'; review: MonitorReviewItem }
  | { key: string; rank: number; kind: 'message'; message: PersonaReport }
  | { key: string; rank: number; kind: 'process'; entry: ProcessEntry };

/** Priority tokens that make an unread report a demand rather than a notice. */
const LOUD_PRIORITIES = new Set(['high', 'urgent']);

/** Process statuses that are a QUESTION, not just work in flight. */
const WAITING_STATUSES = new Set(['input_required', 'draft_ready']);

/**
 * Rank bands, so a kind can never jump a band by accident:
 *   0–2  reviews, by severity bucket
 *   3    a process holding a question (`input_required`)
 *   4    a draft waiting to be read
 *   5    a loud unread report
 *   6    an ordinary unread report
 * Everything below that is not WAITING and is deliberately absent — the queue
 * reading demotes running and queued work to its trailing strip.
 */
function workRank(bucket: SeverityBucket): number {
  return SEVERITY_META[bucket].rank;
}

export function buildWorklist(model: DrawerModel): WorkItem[] {
  const items: WorkItem[] = [];
  for (const review of model.reviews) {
    items.push({
      key: `review:${review.id}`,
      rank: workRank(severityBucket(review.severity)),
      kind: 'review',
      review,
    });
  }
  for (const entry of model.processes) {
    if (!WAITING_STATUSES.has(entry.proc.status)) continue;
    items.push({
      key: `process:${entry.key}`,
      rank: entry.proc.status === 'input_required' ? 3 : 4,
      kind: 'process',
      entry,
    });
  }
  for (const message of model.messages) {
    items.push({
      key: `message:${message.id}`,
      rank: LOUD_PRIORITIES.has(message.priority) ? 5 : 6,
      kind: 'message',
      message,
    });
  }
  // Stable within a band: the inputs are already sorted (severity, then
  // waiting-first, then newest-first), so a plain stable sort preserves it.
  return items.sort((a, b) => a.rank - b.rank);
}

/** Processes the worklist did NOT claim — running, queued, anything unknown. */
export function restProcesses(model: DrawerModel): ProcessEntry[] {
  return model.processes.filter((e) => !WAITING_STATUSES.has(e.proc.status));
}
