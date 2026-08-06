// Fleet session visual identity: each session gets a deterministic ANIMAL
// icon (hash of the session id) so two terminals in the same project are
// tellable at a glance, plus the canonical state ordering used by badges.
import { Bird, Cat, Dog, Fish, Rabbit, Snail, Squirrel, Turtle, type LucideIcon } from 'lucide-react';

import type { Translations } from '@/i18n/generated/types';

import { hash01 } from './hex';

const ANIMALS: LucideIcon[] = [Cat, Dog, Bird, Fish, Rabbit, Squirrel, Turtle, Snail];

export function animalIcon(sessionId: string): LucideIcon {
  return ANIMALS[Math.floor(hash01(sessionId) * ANIMALS.length) % ANIMALS.length] ?? Cat;
}

/** Badge/grouping order — attention-worthy states first. */
export const FLEET_STATE_ORDER = ['awaiting_input', 'running', 'spawning', 'idle', 'stale', 'hibernated', 'exited'] as const;

/** Session state → the Fleet grid's own translated labels. Never render the raw
 *  machine token (CLAUDE.md status-token rule); an unrecognised state falls
 *  through to itself, which is honest rather than blank. Lives here rather than
 *  in one panel because every canvas surface that names a session state has to
 *  name it the same way. */
export const fleetStateLabel = (t: Translations, s: string): string =>
  ({
    spawning: t.plugins.fleet.state_spawning,
    running: t.plugins.fleet.state_working,
    awaiting_input: t.plugins.fleet.state_awaiting_input,
    idle: t.plugins.fleet.state_idle,
    stale: t.plugins.fleet.state_stale,
    hibernated: t.plugins.fleet.state_hibernated,
    exited: t.plugins.fleet.state_exited,
  })[s] ?? s;
