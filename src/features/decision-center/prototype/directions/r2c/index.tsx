/**
 * Prototype direction P2 — "Deck & Ledger": the evolution of the app's own
 * triage lineage. The modal is a card on a deck (TriageFocus's direction-aware
 * spring slide, grown an origin morph and a leave-on-verdict), and every card
 * of every type carries the same ledger rail (BacklogDetailLedger's margin
 * rail, generalised) with the decision docked at its foot.
 */
import type { PrototypeDirection } from '../../directionContract';
import { Hub } from './Hub';

const direction: PrototypeDirection = {
  id: 'r2c',
  name: 'Deck & Ledger',
  tagline: 'Every decision is a card on a deck; every card has the same ledger rail, actions docked at its foot.',
  Hub,
};

export default direction;
