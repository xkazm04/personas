/**
 * Prototype direction R2-B — "Swiss Instrument": P2's Deck & Ledger (every
 * decision a card on a deck, every card the same ledger rail with its actions
 * docked at the foot) re-drawn as a precision instrument: a strict typographic
 * grid, big tabular figures as the hero, hairline rules instead of boxes,
 * monochrome plates with one accent per kind, segmented meters, and the strip
 * as one continuous segmented control with a sliding plate.
 */
import type { PrototypeDirection } from '../../directionContract';
import { Hub } from './Hub';

const direction: PrototypeDirection = {
  id: 'r2b',
  name: 'Swiss Instrument',
  tagline: 'Deck & Ledger as a precision instrument: hairline grid, figures as heroes, one accent per kind.',
  Hub,
};

export default direction;
