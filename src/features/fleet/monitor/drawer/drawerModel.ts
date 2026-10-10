// drawerModel — the ONE view model the drawer's reading renders.
//
// Three readings were built against this model and the operator kept the
// console (2026-10-06); the other two are deleted. The model stays here rather
// than inside `VariantConsole` for the reason it was separated in the first
// place: the thing that paints must not grow its own fetch, its own sort or
// its own idea of how many reviews are pending.
//
// The merged worklist (`WorkItem` / `buildWorklist` / `restProcesses`) left
// with the `queue` reading, which was its only caller.

import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { PersonaCapability } from '@/lib/personas/capabilities';
import type { MonitorReviewItem } from '../useMonitorData';
import type { DrawerSection, PersonaCardModel, ProcessEntry } from '../monitorModel';

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
