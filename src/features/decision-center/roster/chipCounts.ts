/**
 * chipCounts — the strip's eight numbers from one backend round-trip plus the
 * three client-side terms.
 *
 * The law this module exists to keep: **a count is 0 only when its source
 * answered.** A failed `dev_tools_pending_counts` marks every chip it feeds
 * `failed` (keeping the last number it ever answered, never inventing a 0); a
 * failed chat derivation fails only chat. A strip that renders a confident 0
 * over a read that never landed tells the person nothing is waiting — the one
 * lie a decision surface cannot tell.
 *
 * React-free and store-free.
 */
import type { TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import type { PendingCounts } from '@/lib/bindings/PendingCounts';

import { DECISION_CHIPS, type ChipCount, type HubChip } from '../model/decisionModel';

export interface ChipCountInputs {
  /** The last answer `dev_tools_pending_counts` gave, or null before any. */
  pending: PendingCounts | null;
  /** The last attempt to read `pending` failed. */
  pendingFailed: boolean;
  /** Build questions awaiting input — frontend state, no row to count. */
  questions: number;
  /** Chat threads awaiting you, derived client-side. */
  chat: { n: number; failed: boolean };
  /** Accepted ideas never dispatched; null = not answered yet. */
  ready: { n: number | null; failed: boolean };
}

function chip(n: number, failed: boolean, lit: TriageTone): ChipCount {
  return { n, lamp: n > 0 ? lit : 'neutral', failed };
}

export function buildChipCounts(input: ChipCountInputs): Record<HubChip, ChipCount> {
  const p = input.pending;
  const failed = input.pendingFailed;
  const n = (pick: (c: PendingCounts) => number): number => (p ? pick(p) : 0);

  const incidents = n((c) => c.openIncidents);
  const blocking = n((c) => c.blockingIncidents);

  return {
    // Questions are frontend state and cannot fail, but the chip still fails
    // with the read that feeds the rest of it: a gates number missing its
    // reviews and approvals is not the gates number.
    gates: chip(
      n((c) => c.manualReviews + c.companionApprovals) + input.questions,
      failed,
      'warning',
    ),
    proposals: chip(
      n((c) => c.policyProposals + c.promotionProposals + c.goalAcceptance),
      failed,
      'accent',
    ),
    backlog: chip(n((c) => c.ideas), failed, 'neutral'),
    incidents: {
      n: incidents,
      lamp: blocking > 0 ? 'danger' : incidents > 0 ? 'warning' : 'neutral',
      failed,
    },
    council: chip(n((c) => c.councilDecidable), failed, 'accent'),
    reports: chip(n((c) => c.unreadReports), failed, 'accent'),
    chat: chip(input.chat.n, input.chat.failed, 'accent'),
    ready: chip(input.ready.n ?? 0, input.ready.failed, 'success'),
  };
}

/** Sum of the seven decision chips — `ready` is not a decision. */
export function decisionTotal(counts: Record<HubChip, ChipCount>): number {
  return DECISION_CHIPS.reduce((sum, c) => sum + counts[c].n, 0);
}
