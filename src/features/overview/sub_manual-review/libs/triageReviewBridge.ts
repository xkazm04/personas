// triageReviewBridge — what Approvals has to say to the shared `TriageFocus`,
// and the one place this surface degrades on the way to the backend.
//
// `ManualReviewList` owns a queue of `ManualReviewItem` rows and its own
// reload/compare-and-swap loop; `TriageFocus` speaks `TriageItem` and hands
// back a `TriageDecision`. Everything between those two sentences lives here so
// the list file stays a list file.
//
// Three jobs, in order of how much they matter:
//
//  1. ADAPT the rows (`reviewToTriage`, the one adapter the deck also uses).
//  2. Resolve the WORKSPACE TINT into the shape the shared component accepts.
//  3. Encode the per-decision verdict map into the single text column the
//     backend actually has. Read `encodeDecisionVerdicts` before changing it:
//     it is a KNOWN, DOCUMENTED degradation, not an oversight.

import { useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';

import {
  reviewToTriage,
  type TriageReviewRow,
} from '@/features/agents/quick-answer/triage/triageAdapters';
import { useTriageCopy } from '@/features/agents/quick-answer/triage/useTriageCopy';
import type {
  TriageDecision,
  TriageItem,
} from '@/features/agents/quick-answer/triage/triageTypes';
import type { TriagePersonaAccent } from '@/features/shared/components/decisions/useTriageFocus';

import { usePersonaWorkspaceSwatch } from './workspaceTint';

/** Adapt the pending rows the queue is showing into the unified item model. */
export function useTriageReviewItems(rows: readonly TriageReviewRow[]): TriageItem[] {
  const copy = useTriageCopy();
  return useMemo(
    () => rows.filter((r) => r.status === 'pending').map((r) => reviewToTriage(r, copy)),
    [rows, copy],
  );
}

/**
 * The workspace tint, in the shared component's own words.
 *
 * `review-ws-ink` + `--ws-ink` is the whole contract (`workspaceTint.css`):
 * the class mixes the swatch toward the canvas's `--foreground` at a ratio
 * measured per theme family, and the custom property carries which swatch.
 *
 * A persona with NO workspace returns `undefined`, which the component reads
 * as "no accent" and leaves `typo-title`'s own ink in place. That is the
 * deliberate fallback, not a missing case: in dark-midnight the theme's primary
 * tint renders #46e2ff and the cyan workspace swatch #45e1ff, so tinting the
 * no-workspace case would make "belongs to nobody" and "belongs to workspace X"
 * the same colour — the one thing this tint exists to tell apart.
 */
export function useWorkspacePersonaAccent(): TriagePersonaAccent {
  const workspaceSwatch = usePersonaWorkspaceSwatch();
  return useCallback(
    (item: TriageItem) => {
      const swatch = workspaceSwatch(item.personaId);
      if (!swatch) return undefined;
      // A CSS custom property is not expressible in React's CSSProperties.
      // The invariant: `swatch` is a literal from WORKSPACE_COLORS, chosen by
      // a hash over a workspace id — never user input, never interpolated.
      return { className: 'review-ws-ink', style: { '--ws-ink': swatch } as CSSProperties };
    },
    [workspaceSwatch],
  );
}

/**
 * THE DEGRADATION, STATED.
 *
 * `TriageFocus` hands back `answers` — a MAP of option id to verdict, which is
 * the entire reason the component was extracted. `persona_manual_reviews` has
 * no column to put it in: the row carries exactly one free-text
 * `reviewer_notes` (`db/src/migrations/schema.rs:230`), and
 * `update_manual_review_status` takes `reviewer_notes: Option<String>` and
 * nothing else. There is no structured per-decision write door in this app yet.
 *
 * So the map is encoded as text. What this does that the donor did NOT:
 *
 *  • it keeps the option ID beside the label, so the record can be read back
 *    to the option it was about (the donor wrote `+ ${label}` and the id was
 *    gone for good);
 *  • it includes the UNDECIDED options (`?`), so "I ruled on three of five"
 *    is distinguishable from "there were only three" (the donor filtered them
 *    out, so a partial judgement looked complete);
 *  • it keeps the reviewer's own prose as its own paragraph rather than
 *    merging the two into one blob.
 *
 * It is still prose in a text column, and nothing machine-reads it. When a
 * structured door exists, delete this function and pass `decision.answers`
 * straight through — the component has been handing it over correctly the
 * whole time.
 */
export function encodeDecisionVerdicts(decision: TriageDecision): string | undefined {
  const { item, answers, reason } = decision;
  const options = item.decisions ?? [];
  const parts: string[] = [];
  if (reason?.trim()) parts.push(reason.trim());

  if (options.length > 0 && answers && Object.keys(answers).length > 0) {
    const mark = (v: string | undefined) => (v === 'accept' ? '+' : v === 'reject' ? '-' : '?');
    const lines = options.map((o) => `${mark(answers[o.id])} [${o.id}] ${o.label}`);
    parts.push(`Decisions:\n${lines.join('\n')}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
