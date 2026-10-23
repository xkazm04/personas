// The findings ledger's triage rules (PORTED from bp src/lib/train/rules.ts and the constants of
// src/components/ledger/useLedger.ts). Pure. They only decide what the ledger OFFERS and how it orders and marks rows;
// the store owns the transitions, and a refused move comes back as its own `skipped[]` row (the dock console prints it).
import type { Verdict } from '@/lib/lensScan/compare';
import type { Pack, Proposal, ProposalSize, ProposalStatus, Release } from '@/lib/lensScan/wire';
import type { TriageDecisionInput } from '../source';

/** Built and measured, waiting for a person: what the triage scope lists first and what "waiting for you" counts. */
export const WAITING: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['done', 'failed']);
export const isWaiting = (p: Pick<Proposal, 'status'>): boolean => WAITING.has(p.status);

/** The packs' order everywhere (the table, the compare panel's prev/next): oldest first. */
export const byPackAge = (a: Pick<Pack, 'created_at' | 'id'>, b: Pick<Pack, 'created_at' | 'id'>): number =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** The statuses each decision may start from (store.mjs TRIAGE, plus v3 reopen). */
export const TRIAGE_FROM: Readonly<Record<TriageDecisionInput, readonly ProposalStatus[]>> = {
  accept: ['done', 'failed'],
  rework: ['done', 'failed', 'accepted'],
  descope: ['done', 'failed', 'accepted', 'rework', 'proposed', 'approved'],
  reopen: ['accepted', 'rework', 'descoped'],
};

/** Accepting this item ships something that did not prove itself: it failed, or its metric did not move. */
export const isFlagged = (p: Pick<Proposal, 'status'>, verdict: Verdict): boolean => p.status === 'failed' || verdict !== 'moved';

/** Whether the decision may apply now: its status is one the decision starts from, and leaving a release is allowed
 *  only while that release is a draft. */
export function canDecide(d: TriageDecisionInput, p: Pick<Proposal, 'status' | 'release_id'>, release?: Pick<Release, 'status'>): boolean {
  if (!TRIAGE_FROM[d].includes(p.status)) return false;
  if (d !== 'accept' && p.release_id !== undefined && release !== undefined && release.status !== 'draft') return false;
  return true;
}

/** Status order everywhere in the ledger: open first, then moving, then built and waiting, then triage and release, then declined. */
export const LEDGER_STATUSES: readonly ProposalStatus[] = ['proposed', 'approved', 'executing', 'done', 'failed', 'accepted', 'rework', 'descoped', 'released', 'declined'];
/** The pack scope's status chips: built and waiting, then decided, then shipped. */
export const PACK_STATUSES: readonly ProposalStatus[] = ['done', 'failed', 'accepted', 'rework', 'descoped', 'released'];
/** The backlog's status chips: v1's six always; a v2 status only while some finding has it. */
export const V1_STATUSES: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['proposed', 'approved', 'executing', 'done', 'failed', 'declined']);
/** Statuses the backlog can still decide (approve or decline). */
export const OPEN_STATUSES: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['proposed', 'approved']);

/** Effort per size (the rank's denominator and the backlog bar's effort). */
export const SIZE_W: Readonly<Record<ProposalSize, number>> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };
export const sizeW = (p: Pick<Proposal, 'size'>): number => SIZE_W[p.size ?? 'M'] ?? SIZE_W.M;

/**
 * Risk bands of a finding's 1-10 risk (bp useLedger riskBand): the cut the live Build queue's urgency uses, not the
 * health grade's (computeGrade bands a 0-100 score; this bands a 1-10 judgement), so it is its own named table.
 */
export type RiskBand = 'high' | 'medium' | 'low';
export const RISK_BANDS: readonly RiskBand[] = ['high', 'medium', 'low'];
export const RISK_HIGH_FROM = 7;
export const RISK_MEDIUM_FROM = 4;
/** A missing risk reads medium. */
export const riskBand = (r: number | undefined): RiskBand => (r === undefined ? 'medium' : r >= RISK_HIGH_FROM ? 'high' : r >= RISK_MEDIUM_FROM ? 'medium' : 'low');
export const RISK_MARK: Readonly<Record<RiskBand, string>> = { high: '▲', medium: '◆', low: '▽' };

/** Each status as a shape (shape first, colour second: never colour alone). */
export const STATE_MARK: Readonly<Record<ProposalStatus, string>> = {
  proposed: '○', approved: '◐', executing: '◔', declined: '–', done: '●', failed: '✕', accepted: '✓', rework: '↺', descoped: '⊘', released: '◆',
};
export const VERDICT_MARK: Readonly<Record<Verdict, string>> = { moved: '▼', flat: '＝', worse: '▲', unmeasured: '?' };

/** A number as the ledger shows it: integers as they are, others to one decimal (bp tables.ts num). */
export const num = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
