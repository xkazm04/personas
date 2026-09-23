/**
 * The Blueprint's own read of a plan. Presentational, prop-shaped and free of
 * the app shell, so the whole page can be rendered in a harness against the
 * real stylesheet and measured.
 *
 * THE ONE RULE THIS FILE EXISTS FOR: an absent thing is never a zero. Three
 * facts share the same empty column and they are three different marks -
 * a measured nothing (an instrument ran and found none), an unknown (nobody
 * looked), and an unmeasurable (the instrument ran and had nothing to compare
 * against). `CellMark` is the closed vocabulary that keeps them apart, and
 * nothing downstream may collapse it to a number.
 */
import type { CuratorConsentState } from '@/lib/bindings/CuratorConsentState';
import type { CuratorDemand } from '@/lib/bindings/CuratorDemand';
import type { CuratorEngine } from '@/lib/bindings/CuratorEngine';
import type { CuratorPlanItemState } from '@/lib/bindings/CuratorPlanItemState';
import type { CuratorReasonCode } from '@/lib/bindings/CuratorReasonCode';

import type { ChannelId } from './channels';

/** What one cell of the ledger is. Never a number on its own. */
export type CellMark =
  /** The channel scored: a count, with the scan's own sentence behind it. */
  | { kind: 'scored'; mark: ChannelMark }
  /** An instrument ran here and found nothing. */
  | { kind: 'measured-zero' }
  /** Nobody has looked. Not zero, and not inside any total. */
  | { kind: 'unknown' }
  /** The instrument ran and had nothing to compare against. */
  | { kind: 'unmeasurable' };

/** One recognised clause, with whatever extra numbers its sentence carried. */
export interface ChannelMark {
  channel: ChannelId;
  code: CuratorReasonCode;
  /** What this clause contributed to the subject's points. */
  points: number;
  /** The scan's own sentence, kept verbatim. */
  detail: string;
  /** Deduplicated across contributors - the floor that scores. */
  floor?: number;
  /** Summed across contributors - the ceiling, when they disagree. */
  ceil?: number;
  /** The clause's leading count, where it has one. */
  count?: number;
  /** Channel 4 only: the design floor the count is under. */
  designFloor?: number;
  /** Channel 8 only: the single stack. */
  stack?: string;
}

/** One subject the projection would act on. */
export interface BlueprintRow {
  id: string;
  domain: string;
  slug: string;
  /** Where the subject sits in its bundle's taxonomy, slug removed. */
  taxonomy: string;
  at: string;
  points: number;
  rank: number;
  order: number;
  demandKnown: boolean;
  demand: CuratorDemand | null;
  techniques: number;
  applications: number;
  stacks: string[];
  lastSwept: string | null;
  registryDryStreak: number;
  suppressedBySaturation: boolean;
  hasAppliedRow: boolean | null;
  state: CuratorPlanItemState;
  engine: CuratorEngine;
  dominantReason: CuratorReasonCode;
  declinedReason: string | null;
  dispatchedRunId: string | null;
  evidenceRef: string | null;
  /** Every channel, always all nine, each one a mark rather than a number. */
  cells: Record<ChannelId, CellMark>;
}

/** What a column head says about the whole plan, per channel. */
export interface ChannelTotal {
  channel: ChannelId;
  /** Points summed across the rows. */
  points: number;
  /** How many rows carry this channel at all. */
  subjects: number;
  /**
   * Why the column reads zero, when it does. `null` while it scores.
   * `unknown-remainder`: measured zero here, and unasked in N bundles.
   * `unmeasurable-remainder`: measured zero over what could be asked.
   * `pure`: a clean zero, nothing here and nothing unasked.
   */
  emptiness: 'unknown-remainder' | 'unmeasurable-remainder' | 'pure' | null;
}

/** One bundle's share of the subjects that score nothing. */
export interface QuietBundle {
  domain: string;
  subjects: number;
  demandKnown: boolean;
}

/**
 * One consumer project, as the registry's map check sees it, joined to what
 * the OPERATOR has said about that checkout.
 *
 * The two halves come from two different doors and they can disagree: the map
 * can carry a project Curator is not allowed to touch. `reach` is `null` when
 * `curator_projects_list` knows nothing about this slug - which is not
 * "refused", and must not be drawn as one.
 */
export interface ConsumerProject {
  slug: string;
  contexts: number;
  pairs: number;
  evaluated: number;
  staleVerdicts: number;
  weak: number;
  state: string;
  reach: { enabled: boolean; consent: CuratorConsentState } | null;
}

export interface BlueprintModel {
  planRunId: string;
  createdAt: string;
  scanGeneratedAt: string;
  registryHeadSha: string | null;
  /** Subjects the whole corpus holds. */
  subjects: number;
  techniques: number;
  applications: number;
  domains: number;
  /** Applications carrying no clock at all, so they cannot expire. */
  noClockApplications: number;
  expiredApplications: number;
  atRiskApplications: number;
  driftUnknown: number;
  drift: number;
  /** The bundles whose demand was actually read. */
  demandKnownDomains: string[];
  /** 10 minus the read ones - where channels 1 and 7 are unknown. */
  unknownDemandBundles: number;
  /** One distinct two-letter mark per bundle, derived from the domains present. */
  bundleMark: Record<string, string>;
  rows: BlueprintRow[];
  /** Sum of the rows' points. With a whole plan, this IS the corpus's points. */
  planPoints: number;
  maxPoints: number;
  /** The widest deviation ceiling in the plan, for the track scale. */
  maxCeiling: number;
  totals: Record<ChannelId, ChannelTotal>;
  quiet: QuietBundle[];
  quietSubjects: number;
  /**
   * Subjects the corpus counts that neither the rows nor the quiet tail
   * account for. Zero for a whole projection; above zero it is a FINDING
   * about the plan, drawn as a band with unknown columns, never as work.
   */
  unlisted: number;
  consumers: {
    projects: ConsumerProject[];
    pairs: number;
    evaluated: number;
    staleVerdicts: number;
    weak: number;
    staleProjects: number;
    mapsStale: boolean;
    problems: string[];
  };
  /** The policy AS IT WAS when the projection was made. */
  policy: BlueprintPolicy;
  /**
   * The policy NOW, when it could be read. The plan carries the version a
   * person agreed to; a surface that showed only one of the two would hide the
   * moment they stopped matching.
   */
  livePolicy: BlueprintPolicy | null;
  /** Which policy fields the live read disagrees with. Empty means they agree. */
  policyDrift: (keyof BlueprintPolicy)[];
}

/** The operator's standing settings, as one value. */
export interface BlueprintPolicy {
  backpressureN: number;
  workerCap: number;
  dailyBudgetUsd: number | null;
  dailyRunCap: number | null;
  dailyCommitCap: number | null;
  quietHours: string | null;
  levels: { research: string; forge: string; conform: string; sweep: string };
}
