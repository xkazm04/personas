// piles — the fleet's ONE state vocabulary (registry: status-vocabulary).
//
// At a hundred personas the eye sorts the fleet into four piles before it
// reads a single name, so every Activity line, every rail row and every
// skinned tile speak the same four words:
//
//   needs   - something waits on a human: the loudest thing on screen
//             (red for a failed run or a critical review, amber otherwise)
//   working - running now: lit in the theme colour, moving
//   resting - on and idle (or only queued): present, quiet
//   off     - switched off: hatched, quieter still
//
// RELOCATED 2026-10-06 from `fleetboard/piles.ts`. The Board view it was
// written for is gone; the vocabulary is not, because Activity's persona and
// session lines (`grid/prototype/entry-e/`) and the Decision rail
// (`grid/rail/`) wear it. It lives beside its only consumers now, and the
// `fb-` prefix its CSS still carries is explained in `skin.css`.
//
// THIS IS NOT A NEW STATE MACHINE. It folds the Monitor's own ranking: `needs`
// is `actionWeight > 0` (the same predicate the attention cursor walks and the
// Activity board's "needs you" filter uses, unread messages included - the
// operator's call), its reason and urgency are the head of `actionBadges`
// (failed > review > input > draft > message), and `working` is
// `pillarStateKey === 'running'`. `needs` wins over `off` and `working`: a
// running persona holding a review is drawn as needing you.

import { Activity, AlertOctagon, AlertTriangle, Moon, PowerOff, type LucideIcon } from 'lucide-react';
import { pillarStateKey, type PersonaCardModel } from '../../monitorModel';
import { actionWeight, dominantBadge, type ActionKind } from '../fleetGridModel';

export type Pile = 'needs' | 'working' | 'resting' | 'off';
export type NeedTone = 'critical' | 'warning';
/** A pile with its needs tone resolved: the key every visual is looked up by. */
export type PileKey = NeedTone | Exclude<Pile, 'needs'>;

/** Reading order: inside a bay, in the mix bar, in the legend. */
export const PILE_ORDER: readonly Pile[] = ['needs', 'working', 'resting', 'off'];

export function pileOf(card: PersonaCardModel): Pile {
  if (actionWeight(card) > 0) return 'needs';
  if (card.enabled === false) return 'off';
  if (pillarStateKey(card) === 'running') return 'working';
  return 'resting';
}

/**
 * Why a persona needs you: the head of `actionBadges`. A review counted by the
 * badge query but not yet classified has no severity and no badge; it still
 * weighs, so it still reads as a review.
 */
export function needReason(card: PersonaCardModel): ActionKind | null {
  const head = dominantBadge(card);
  if (head) return head.key;
  return actionWeight(card) > 0 ? 'review' : null;
}

/** Red for a failure or a critical review, amber for everything else. */
export function needTone(card: PersonaCardModel): NeedTone {
  const reason = needReason(card);
  if (reason === 'failed') return 'critical';
  return reason === 'review' && card.topReviewSeverity === 'critical' ? 'critical' : 'warning';
}

export function pileKey(card: PersonaCardModel): PileKey {
  const pile = pileOf(card);
  return pile === 'needs' ? needTone(card) : pile;
}

export interface PileVisual {
  /** The colour role, a CSS expression over status tokens (set as `--fb-tone`). */
  tone: string;
  /** The pile's own glyph (a needs tile draws its REASON glyph instead). */
  glyph: LucideIcon;
  /** `t.monitor.<labelKey>`. */
  labelKey: 'board_pile_needs' | 'board_pile_working' | 'board_pile_resting' | 'board_pile_off';
}

/**
 * The one table from pile to colour role, glyph and label. Working is the
 * theme colour rather than a status hue on purpose: the Activity board paints
 * running in `--primary` (`SQUARE_VISUAL.running`, entry-e's `ae-t-run`), and
 * the same persona must not change colour between two views of one Monitor.
 */
export const PILE_VISUAL: Record<PileKey, PileVisual> = {
  critical: { tone: 'var(--status-error)', glyph: AlertOctagon, labelKey: 'board_pile_needs' },
  // --fb-warning is --status-warning, except as a FILL on light themes (skin.css).
  warning: { tone: 'var(--fb-warning)', glyph: AlertTriangle, labelKey: 'board_pile_needs' },
  working: { tone: 'var(--primary)', glyph: Activity, labelKey: 'board_pile_working' },
  resting: { tone: 'var(--status-neutral)', glyph: Moon, labelKey: 'board_pile_resting' },
  off: { tone: 'color-mix(in oklab, var(--foreground) 30%, transparent)', glyph: PowerOff, labelKey: 'board_pile_off' },
};

/** The visual for a pile in the aggregate (strip, legend): needs reads amber. */
export const pileVisual = (pile: Pile): PileVisual => PILE_VISUAL[pile === 'needs' ? 'warning' : pile];

/** `t.monitor.<key>` for a need reason. A label lookup, not a second state table. */
export const REASON_LABEL_KEY: Record<ActionKind, `board_reason_${ActionKind}`> = {
  failed: 'board_reason_failed',
  review: 'board_reason_review',
  input: 'board_reason_input',
  draft: 'board_reason_draft',
  message: 'board_reason_message',
};

const REASON_RANK: Record<ActionKind, number> = { failed: 0, review: 1, input: 2, draft: 3, message: 4 };

/** Lower is more urgent: the badge order, a critical review ahead of its kind. */
export function urgency(card: PersonaCardModel): number {
  const reason = needReason(card);
  if (reason === null) return 99;
  const critical = reason === 'review' && card.topReviewSeverity === 'critical' ? 0 : 0.5;
  return REASON_RANK[reason] + critical;
}

const PILE_RANK: Record<Pile, number> = { needs: 0, working: 1, resting: 2, off: 3 };

/**
 * A bay's reading order: needs (most urgent first, then the heaviest), then
 * working, resting, off; incoming order inside each pile. It depends only on
 * state, so a tile moves when its persona changes pile, never on a tick.
 */
export function orderByPile(cards: readonly PersonaCardModel[]): PersonaCardModel[] {
  return cards
    .map((card, i) => ({ card, i, pile: pileOf(card) }))
    .sort((a, b) => PILE_RANK[a.pile] - PILE_RANK[b.pile]
      || (a.pile === 'needs' ? urgency(a.card) - urgency(b.card) || actionWeight(b.card) - actionWeight(a.card) : 0)
      || a.i - b.i)
    .map((x) => x.card);
}

export interface PileCounts {
  needs: number;
  critical: number;
  working: number;
  resting: number;
  off: number;
  total: number;
}

export function countPiles(cards: readonly PersonaCardModel[]): PileCounts {
  const c: PileCounts = { needs: 0, critical: 0, working: 0, resting: 0, off: 0, total: cards.length };
  for (const card of cards) {
    const pile = pileOf(card);
    c[pile] += 1;
    if (pile === 'needs' && needTone(card) === 'critical') c.critical += 1;
  }
  return c;
}
