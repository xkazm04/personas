// useSimWorld — the simulated fleet, built once and held for the session.
//
// The roster, the cards and the sessions are pure functions of their seeds, so
// they are built ONCE into a module singleton rather than per mount. Two
// reasons, and the second is the one that decided it:
//
//   • Cost. Sixty cards, twenty-two sessions and a hundred-odd rail rows is
//     not free, and the Monitor is an overlay that mounts on every open.
//   • IDENTITY. `PersonaTile` is memoized on its card and `ColumnBody` keys
//     rows by id; rebuilding the world on each mount would hand every tile a
//     new object with the same contents, and the board would re-render whole
//     while looking identical. A fixture that makes the surface behave worse
//     than the real one measures the wrong thing.
//
// The PLANS are the exception. They are anchored to the wall clock (their
// meters count down towards a reset), and they are the one part of the world
// the operator can change from the UI — switching the live plan, forgetting a
// dead one. So they live in React state, seeded once per mount.

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ClaudeAccountsSnapshot } from '@/lib/bindings/ClaudeAccountsSnapshot';
import type { ClaudeAutoRotateConfig } from '@/lib/bindings/ClaudeAutoRotateConfig';
import { groupSessions, type SessionGrouping } from '../fleetSessionModel';
import { buildSimCards } from './simCards';
import { buildSimRoster, type SimRoster } from './simFleet';
import { buildSimSessions } from './simSessions';
import { buildSimAccountsSnapshot, simRemoveAccount, simSwitchActive } from './simPlans';
import type { PersonaCardModel } from '../../monitorModel';

export interface SimWorld {
  roster: SimRoster;
  cards: PersonaCardModel[];
  /** Already routed cwd → project → team, by the board's own grouper. */
  sessions: SessionGrouping;
}

let world: SimWorld | null = null;

/** The fleet half of the world — deterministic, so it is built at most once. */
export function simWorld(): SimWorld {
  if (world) return world;
  const roster = buildSimRoster();
  world = {
    roster,
    cards: buildSimCards(roster),
    sessions: groupSessions(buildSimSessions(roster), roster.projects),
  };
  return world;
}

export interface SimPlans {
  /** Null while the simulation is off — the strip reads its real accounts then. */
  snapshot: ClaudeAccountsSnapshot | null;
  switchTo: (id: string) => void;
  remove: (id: string) => void;
  setAutoRotate: (config: ClaudeAutoRotateConfig) => void;
}

/**
 * The plan half — stateful, because the strip's three acts change it. Every act
 * stays wired while simulating: the confirm dialogs, the switch, the forget and
 * the auto-rotate threshold all run their real components and land in this
 * state instead of in the backend, so the flows can be walked end to end.
 */
export function useSimPlans(enabled: boolean): SimPlans {
  // The seed is built only once the strip is actually simulating: a production
  // Monitor mounts this hook too, and it should not pay for five fixture plans
  // it will never render. Edits ride ON TOP of the seed, so switching the
  // simulation off and on again returns to the plans as the operator left them.
  const seed = useMemo(() => (enabled ? buildSimAccountsSnapshot() : null), [enabled]);
  const [edited, setEdited] = useState<ClaudeAccountsSnapshot | null>(null);
  const snapshot = enabled ? (edited ?? seed) : null;

  // `edit` must see the snapshot of the render it fires in, not the one it
  // closed over at mount; a ref is the smallest thing that guarantees that.
  const latest = useRef<ClaudeAccountsSnapshot | null>(null);
  latest.current = snapshot;

  const edit = useCallback(
    (fn: (s: ClaudeAccountsSnapshot) => ClaudeAccountsSnapshot) =>
      setEdited((prev) => {
        const base = prev ?? latest.current;
        return base ? fn(base) : prev;
      }),
    [],
  );

  const switchTo = useCallback((id: string) => edit((s) => simSwitchActive(s, id)), [edit]);
  const remove = useCallback((id: string) => edit((s) => simRemoveAccount(s, id)), [edit]);
  const setAutoRotate = useCallback(
    (config: ClaudeAutoRotateConfig) => edit((s) => ({ ...s, autoRotate: config })),
    [edit],
  );

  return useMemo(
    () => ({ snapshot, switchTo, remove, setAutoRotate }),
    [snapshot, switchTo, remove, setAutoRotate],
  );
}

/** Test hatch — the fleet half is a module singleton. */
export function _resetSimWorldForTests(): void {
  world = null;
}
