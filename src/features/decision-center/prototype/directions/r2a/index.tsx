/**
 * Refine round 2, variant A — "Obsidian Glass": P2's Deck & Ledger (structure,
 * data, keyboard grammar and behaviour unchanged) re-materialised as layered
 * dark glass. A frosted card over a vignetted floor, gradient hairlines keyed
 * to the kind's tone, ambient light thrown from the kind tile, a recessed
 * ledger well, arc and capsule meters, a ghost stack that carries the queue's
 * depth, and keys printed once — inside the button that does the thing.
 * Light themes read the same recipe as frosted paper.
 */
import type { PrototypeDirection } from '../../directionContract';
import { Hub } from './Hub';
import './r2a.css';

const direction: PrototypeDirection = {
  id: 'r2a',
  name: 'Obsidian Glass',
  tagline: 'P2’s deck as layered glass: tone-lit frosted cards, a recessed ledger, keys printed once where the action is.',
  Hub,
};

export default direction;
