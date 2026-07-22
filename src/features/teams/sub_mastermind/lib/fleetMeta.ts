// Fleet session visual identity: each session gets a deterministic ANIMAL
// icon (hash of the session id) so two terminals in the same project are
// tellable at a glance, plus the canonical state ordering used by badges.
import { Bird, Cat, Dog, Fish, Rabbit, Snail, Squirrel, Turtle, type LucideIcon } from 'lucide-react';

import { hash01 } from './hex';

const ANIMALS: LucideIcon[] = [Cat, Dog, Bird, Fish, Rabbit, Squirrel, Turtle, Snail];

export function animalIcon(sessionId: string): LucideIcon {
  return ANIMALS[Math.floor(hash01(sessionId) * ANIMALS.length) % ANIMALS.length] ?? Cat;
}

/** Badge/grouping order — attention-worthy states first. */
export const FLEET_STATE_ORDER = ['awaiting_input', 'running', 'spawning', 'idle', 'stale', 'hibernated', 'exited'] as const;
