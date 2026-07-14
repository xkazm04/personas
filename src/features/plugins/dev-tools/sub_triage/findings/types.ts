// Shared shapes for the findings spine (docs/plans/dev-findings-loop.md §3 2B).
import type { FindingOrigin } from '@/api/devTools/devTools';

export type { FindingOrigin };

/**
 * What an emitter produces. Deliberately NOT a DevIdea — a draft has no id and
 * may never be persisted (dedup or the sweep cap can drop it).
 */
export interface FindingDraft {
  origin: FindingOrigin;
  /** Imperative, ≤80 chars — this becomes the idea/task title. */
  title: string;
  /** Says what to DO. Seeds the Claude-Code task prompt if the idea is accepted. */
  description: string;
  /** One of the canonical idea categories (normalised again in Rust). */
  category: string;
  contextId?: string;
  useCaseId?: string;
  /** The raw numbers the threshold decision was made on (Phase-3 re-measurement). */
  evidence: Record<string, unknown>;
  /** Stable per underlying signal. See emitters.ts for the key scheme. */
  dedupKey: string;
  /** 1–5 triage seeds. */
  effort?: number;
  impact?: number;
  risk?: number;
}

/** One unresolved Sentry issue — the subset of the API row the emitter needs. */
export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  /** Sentry's best guess at the code location. Often, but not always, a file path. */
  culprit: string | null;
  count: number;
  lastSeen: string | null;
}

/** An off-track KPI — the shared shape the Factory badge and E5 both read. */
export interface KpiAttention {
  groupId: string;
  kpiId: string;
  name: string;
  current: number | null;
  target: number;
  unit: string;
  useCaseId?: string;
}

/** What a sweep did — surfaced to the user so a cap is never silent. */
export interface SweepResult {
  /** Findings actually written to dev_ideas. */
  created: number;
  /** Drafts skipped because their dedup key already exists (any status). */
  duplicates: number;
  /** Drafts dropped by SWEEP_CAP — reported, never hidden. */
  dropped: number;
  /** Sensors that couldn't be read (not wired / errored) — a sweep still runs. */
  skippedSensors: string[];
  /** Verdicts taken on shipped findings this pass (Phase 3A). `unchanged` and
   *  `regressed` are reported alongside `cleared` — merged is not fixed. */
  verified: { cleared: number; moved: number; unchanged: number; regressed: number };
}
