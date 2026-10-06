/**
 * Refine round 2, variant C — "Aurora Deck": P2's Deck & Ledger (structure,
 * keys and behaviour unchanged) in a bolder material. The deck floats in a
 * field of slow kind-tone aurora light, the focused card wears a living conic
 * border, the queue behind it is a 3D ghost stack, verdicts land as big
 * stamps, and the strip's chips glow by urgency.
 */
import type { PrototypeDirection } from '../../directionContract';
import { Hub } from './Hub';
import './aurora.css';

const direction: PrototypeDirection = {
  id: 'r2c',
  name: 'Aurora Deck',
  tagline: 'The deck floats in kind-tone light: a living border on the card in hand, the queue as a 3D stack, chips that glow by urgency.',
  Hub,
};

export default direction;
