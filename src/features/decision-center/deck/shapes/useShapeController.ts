/**
 * The card in hand's lane shape, its state and its keys, in one place the
 * session, the card and the keyboard all read.
 *
 * Key map per shape (on top of `useDeckKeys`, which keeps ←/→, ↑/↓, S, I, ?,
 * Enter and Esc for every shape):
 *   sign     A sign (arms when it grants merge or spend) · X drop · E edit.
 *            R is inert: the card's no is Drop, printed as X.
 *   breach   1 amend · 2 deny · 3 suspend · 4-9 the item's own branches.
 *            A and R are inert: the verdicts are the numbered verbs.
 *   claim    A accept · R send back · 1-3 pick an audited act · V revert it ·
 *            N narrow its scope · 4-9 the item's own branches.
 *   valve    the default A (armed twice) / R; never a batch branch.
 * None of E, X, V, N is bound anywhere else in the deck grammar.
 */
import type { DecisionItem } from '../../model/decisionModel';
import type { DeckController } from '../useDeck';
import { BRANCH_OFFSET, behindIt, routeOf, shapeOf, valveStep, type CardShape, type ShapeRoute } from './cardShape';
import { useDeckLanes } from './DeckLaneContext';
import { useBreachShape, type BreachShape } from './useBreachShape';
import { useClaimShape, type ClaimShape } from './useClaimShape';
import { useSignShape, type SignShape } from './useSignShape';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';

export interface ShapeController {
  shape: CardShape;
  route: ShapeRoute | null;
  mandate: MandateSummary | null;
  /** Items 4-9: the item's own branches start after the shape's digits. */
  offset: number;
  /** The shape's yes arms first (a sign that grants, an amend on merge or spend). */
  arms: boolean;
  sign: SignShape;
  breach: BreachShape;
  claim: ClaimShape;
  valve: { index: number; total: number } | null;
  behind: DecisionItem[];
  /** A / Enter: the shape's own yes, or null for the deck's default verb. */
  accept: ((fallback: () => void) => void) | null;
  /** The shape's keys; true when the press was taken (or deliberately inert). */
  onKey: (e: KeyboardEvent, digit: number | null, fallback: () => void) => boolean;
}

export function useShapeController(item: DecisionItem | undefined, deck: DeckController): ShapeController {
  const { lanes, mandates } = useDeckLanes();
  const route = item ? routeOf(item, lanes) : null;
  const shape: CardShape = item ? shapeOf(item, route) : 'default';
  const charterId = item?.kind === 'mandate' ? item.sourceId : route?.charterId ?? null;
  const mandate = charterId ? mandates.get(charterId) ?? null : null;

  const sign = useSignShape(shape === 'sign', item, mandate, deck);
  const breach = useBreachShape(shape === 'breach', item, route, mandate, deck);
  const claim = useClaimShape(shape === 'claim', item, route, mandate);

  const accept = shape === 'sign' ? () => sign.sign() : shape === 'breach' ? breach.amend : null;
  const arms = shape === 'sign' ? sign.grants.length > 0 : shape === 'breach' ? !!breach.plan?.arms : false;

  const onKey = (e: KeyboardEvent, digit: number | null, fallback: () => void): boolean => {
    const k = e.key.toLowerCase();
    if (shape === 'sign') {
      if (digit) return false;
      if (k === 'e') { sign.toggleEdit(); return true; }
      if (k === 'x') { sign.drop(); return true; }
      return k === 'r';
    }
    if (shape === 'breach') {
      if (digit === 1) { breach.amend(fallback); return true; }
      if (digit === 2) { breach.deny(); return true; }
      if (digit === 3) { breach.suspend(); return true; }
      return !digit && (k === 'a' || k === 'r');
    }
    if (shape === 'claim') {
      if (digit && digit <= BRANCH_OFFSET.claim) return claim.pick(digit - 1);
      if (k === 'v') { claim.revert(); return true; }
      if (k === 'n') { claim.narrow(); return true; }
    }
    return false;
  };

  return {
    shape,
    route,
    mandate,
    offset: BRANCH_OFFSET[shape],
    arms,
    sign,
    breach,
    claim,
    valve: shape === 'valve' && item ? valveStep(deck.queue, item, lanes) : null,
    behind: shape === 'breach' && item ? behindIt(deck.queue, item, lanes) : [],
    accept,
    onKey,
  };
}
