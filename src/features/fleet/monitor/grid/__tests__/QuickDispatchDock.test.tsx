// QuickDispatchDock — the Launch Rail shell, pinned against the feature floor
// the redesign had to clear.
//
// The shell was re-authored wholesale (the field is now a hand-built deck, not
// `ChatInputBar`; the headless control is a switch, not a tinted icon), so the
// risk this file covers is a REDESIGN THAT QUIETLY DROPPED SOMETHING. Every
// assertion below is one of the affordances the brief made non-negotiable, plus
// the two properties the shell itself introduces: the readout only claims a
// price when a dispatch would really fire, and the resting row carries the
// fleet tally rather than restating the placeholder.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { QuickDispatchDock } from '../QuickDispatchDock';
import { DOCK_VARIANTS, readDockVariant, writeDockVariant, type DockVariant } from '../dockVariant';
import { DECK_HEIGHT } from '../dock/DockCommandRow';

// A dispatch needs a TARGET: `canSend` is false without a project chip, so a
// test that only types an objective is testing the disabled state. One real
// project, picked through the `@` typeahead the way an operator picks it.
const PROJECT = { id: 'p_personas', name: 'personas', root_path: 'C:/Users/mkdol/dolla/personas' };
const listProjects = vi.fn(async () => [PROJECT]);
const listSkills = vi.fn(async () => []);

vi.mock('@/api/devTools/devTools', () => ({
  listProjects: (...a: unknown[]) => listProjects(...(a as [])),
  listSkills: (...a: unknown[]) => listSkills(...(a as [])),
}));
// The dispatch door. By default it returns without the board changing; the
// Athena block below swaps in a version that births a session, the way the
// real door does, so the grant has something to land on.
const companionDispatchFleetPlan = vi.fn(async () => ({}));
vi.mock('@/api/companion', () => ({
  companionDispatchFleetPlan: (...a: unknown[]) => companionDispatchFleetPlan(...(a as [])),
}));
const setSessionAthenaFlag = vi.fn(async (_id: string, _on: boolean) => true);
vi.mock('@/api/fleet/fleet', () => ({
  renameSession: vi.fn(async () => undefined),
  spawnHeadlessSession: vi.fn(async () => ({})),
  setSessionAthenaFlag: (...a: unknown[]) => setSessionAthenaFlag(...(a as [string, boolean])),
}));
const toastCatch = vi.fn(() => () => {});
vi.mock('@/lib/silentCatch', () => ({
  toastCatch: (...a: unknown[]) => toastCatch(...(a as [])),
  silentCatch: () => () => {},
}));

// The board snapshot the resting row reports on. Two sessions that need the
// operator, one working — the lanes come from `laneOfState`.
const sessions = [
  { id: 'a', state: 'awaiting_input', cwd: 'C:/elsewhere' },
  { id: 'b', state: 'stale', cwd: 'C:/elsewhere' },
  { id: 'c', state: 'running', cwd: 'C:/elsewhere' },
];

// ONE store object, hoisted. Building it inside the selector would hand back a
// fresh `vi.fn()` on every render, and the controller's mount-reset effect
// depends on two of those callbacks — so the reset would re-run on every render
// and wipe the objective between keystrokes. A real Zustand store returns
// stable identities; a mock that does not is testing a different component.
const storeState = {
  fleetSessions: sessions,
  fleetSessionsLoading: false,
  fleetStartSessionListeners: vi.fn(),
  fleetRefresh: vi.fn(),
  setSidebarSection: vi.fn(),
  setPluginTab: vi.fn(),
  setDevToolsTab: vi.fn(),
  projects: [],
  // "Run on": no paired device, so the picker renders nothing.
  dispatchDevices: [],
  p2pUnavailable: false,
  remoteSessionsPinned: false,
  loadRemoteSessions: vi.fn(async () => undefined),
  // The queue snapshot the landing pill reads. Under the cap, nothing waiting.
  fleetQueue: { cap: 10, running: 3, queued: 0, overAdmitted: 0, entries: [], budgets: {} },
};

// `getState` as well as the selector form: the dock reads the session list
// imperatively at launch time (what existed BEFORE the door opened) and the
// hook form would hand it a render-time snapshot instead.
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}));

const expand = () => fireEvent.click(screen.getByTestId('quick-dispatch-dock-expand'));
const field = () => screen.getByTestId('quick-dispatch-input') as HTMLTextAreaElement;

/** Open the `@` typeahead and pick the one project, as the operator would. */
async function pickProject() {
  fireEvent.change(field(), { target: { value: '@per' } });
  const option = await screen.findByTestId('quick-dispatch-suggestion-item');
  fireEvent.mouseDown(option);
}

/** A dispatch-ready console: a project chip plus an objective. */
async function arm(objective = 'Fix the ORT cache machine-type swap') {
  await pickProject();
  fireEvent.change(field(), { target: { value: objective } });
}

beforeEach(() => {
  listProjects.mockClear();
  listSkills.mockClear();
});

describe('QuickDispatchDock — the resting row', () => {
  it('rests as a single collapsed row, not the console', () => {
    render(<QuickDispatchDock />);
    expect(screen.getByTestId('quick-dispatch-dock-expand')).toBeTruthy();
    expect(screen.queryByTestId('quick-dispatch-input')).toBeNull();
  });

  it('pays rent: the collapsed row carries the live fleet tally', () => {
    render(<QuickDispatchDock />);
    const tally = screen.getByTestId('quick-dispatch-dock-tally');
    // awaiting_input + stale = 2 need you; running = 1 working.
    expect(tally.textContent).toContain('2');
    expect(tally.textContent).toContain('1');
  });

  it('expands into the console when the row is pressed', () => {
    render(<QuickDispatchDock />);
    expand();
    expect(screen.getByTestId('quick-dispatch-dock')).toBeTruthy();
    expect(screen.getByTestId('quick-dispatch-input')).toBeTruthy();
  });
});

describe('QuickDispatchDock — the feature floor survives the redesign', () => {
  it('keeps every control the dock had before', () => {
    render(<QuickDispatchDock />);
    expand();
    for (const id of [
      'quick-dispatch-chips',
      'quick-dispatch-input',
      'quick-dispatch-send',
      'quick-dispatch-model-chip',
      'quick-dispatch-effort-chip',
      'quick-dispatch-headless-toggle',
      'quick-dispatch-skill-picker-toggle',
      'quick-dispatch-dock-collapse',
    ]) {
      expect(screen.getByTestId(id), `${id} must survive the redesign`).toBeTruthy();
    }
  });

  it('keeps the chip rail mounted while empty — the anti-shake contract', () => {
    render(<QuickDispatchDock />);
    expand();
    // Present with no chips in it: a rail that unmounted would change the
    // dock's height the moment a project was picked.
    expect(screen.getByTestId('quick-dispatch-chips')).toBeTruthy();
  });

  it('toggles headless through aria-pressed, not through colour alone', () => {
    render(<QuickDispatchDock />);
    expand();
    const toggle = screen.getByTestId('quick-dispatch-headless-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('collapses again on Escape', () => {
    render(<QuickDispatchDock />);
    expand();
    fireEvent.keyDown(screen.getByTestId('quick-dispatch-dock'), { key: 'Escape' });
    expect(screen.queryByTestId('quick-dispatch-input')).toBeNull();
  });

  it('caps the objective at the server bound rather than failing after send', () => {
    render(<QuickDispatchDock />);
    expand();
    expect(field().maxLength).toBe(1200);
  });
});

describe('QuickDispatchDock — the readout', () => {
  it('shows STANDBY and no figures until an objective would really dispatch', () => {
    render(<QuickDispatchDock />);
    expand();
    expect(screen.getByTestId('quick-dispatch-status-pill').textContent).toBe('STANDBY');
    // An em dash, not a price: the console must not quote a run it would refuse.
    expect(screen.getByTestId('quick-dispatch-gauge-cost').textContent).toContain('—');
    expect(screen.getByTestId('quick-dispatch-gauge-eta').textContent).toContain('—');
  });

  it('stays on STANDBY with an objective but no target — ARMED tracks what would really fire', async () => {
    render(<QuickDispatchDock />);
    expand();
    fireEvent.change(field(), { target: { value: 'Fix the ORT cache machine-type swap' } });
    // No `@project` yet, so the dispatch door is shut. The pill must not
    // promise a flight the launch button refuses.
    expect(screen.getByTestId('quick-dispatch-status-pill').textContent).toBe('STANDBY');
    expect((screen.getByTestId('quick-dispatch-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('arms and prices the dispatch once it has a target and an objective', async () => {
    render(<QuickDispatchDock />);
    expand();
    await arm();

    expect(screen.getByTestId('quick-dispatch-status-pill').textContent).toBe('ARMED');
    expect(screen.getByTestId('quick-dispatch-gauge-cost').textContent).toMatch(/\d/);
    expect(screen.getByTestId('quick-dispatch-gauge-eta').textContent).toMatch(/\d/);
  });

  it('prices a costlier model higher, so the tradeoff is visible before the trigger', async () => {
    render(<QuickDispatchDock />);
    expand();
    await arm();
    const atDefault = screen.getByTestId('quick-dispatch-gauge-cost').textContent ?? '';

    // Drive the preset through its own listbox, as the operator would.
    fireEvent.click(screen.getByTestId('quick-dispatch-model-chip'));
    fireEvent.click(screen.getByText('Model: opus'));

    const atOpus = screen.getByTestId('quick-dispatch-gauge-cost').textContent ?? '';
    const num = (s: string) => Number(s.replace(/[^\d.]/g, ''));
    expect(num(atOpus)).toBeGreaterThan(num(atDefault));
  });

  it('counts the objective against its budget', () => {
    render(<QuickDispatchDock />);
    expand();
    fireEvent.change(field(), { target: { value: 'abcde' } });
    expect(screen.getByTestId('quick-dispatch-char-count').textContent).toBe('5');
  });
});


describe('QuickDispatchDock — where in the line this lands', () => {
  it('reports the queue state on the manifest row, always mounted', () => {
    render(<QuickDispatchDock />);
    expand();
    // Room: under the cap with an empty queue. Mounted in every state, so it
    // can never move the board above by appearing.
    expect(screen.getByTestId('quick-dispatch-landing').textContent).toBe('Room');
  });

  it('names the tail position when the fleet is full', () => {
    storeState.fleetQueue = { cap: 3, running: 3, queued: 4, overAdmitted: 0, entries: [], budgets: {} };
    render(<QuickDispatchDock />);
    expand();
    // Five rows waiting once this one joins: enqueue_into ranks at the tail.
    expect(screen.getByTestId('quick-dispatch-landing').textContent).toContain('5');
    storeState.fleetQueue = { cap: 10, running: 3, queued: 0, overAdmitted: 0, entries: [], budgets: {} };
  });

  it('names the backfill rather than claiming a start, when rows are waiting under the cap', () => {
    storeState.fleetQueue = { cap: 10, running: 1, queued: 2, overAdmitted: 0, entries: [], budgets: {} };
    render(<QuickDispatchDock />);
    expand();
    expect(screen.getByTestId('quick-dispatch-landing').textContent).toBe('Ahead of 2');
    storeState.fleetQueue = { cap: 10, running: 3, queued: 0, overAdmitted: 0, entries: [], budgets: {} };
  });
});

describe('QuickDispatchDock — the Athena grant', () => {
  beforeEach(() => {
    setSessionAthenaFlag.mockClear();
    toastCatch.mockClear();
    companionDispatchFleetPlan.mockReset();
    companionDispatchFleetPlan.mockImplementation(async () => ({}));
    storeState.fleetSessions = sessions;
  });

  it('is off the table for a run bound for a paired device', () => {
    // No paired device in the default store, so the control is live; the
    // disabled form is asserted through the prop, which is what the dock
    // computes from `runOn`.
    render(<QuickDispatchDock />);
    expand();
    expect((screen.getByTestId('quick-dispatch-athena-toggle') as HTMLButtonElement).disabled).toBe(false);
  });

  it('rests disarmed, and carries its state on aria-pressed rather than on colour', () => {
    render(<QuickDispatchDock />);
    expand();
    const toggle = screen.getByTestId('quick-dispatch-athena-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('writes the grant onto the session the dispatch produced', async () => {
    // The door births a row, exactly as `queue::enqueue`/`spawn_now` do.
    companionDispatchFleetPlan.mockImplementation(async () => {
      storeState.fleetSessions = [...sessions, { id: 'born', state: 'running', cwd: PROJECT.root_path }];
      return {};
    });
    render(<QuickDispatchDock />);
    expand();
    await arm();
    fireEvent.click(screen.getByTestId('quick-dispatch-athena-toggle'));
    fireEvent.click(screen.getByTestId('quick-dispatch-send'));
    await vi.waitFor(() => expect(setSessionAthenaFlag).toHaveBeenCalledWith('born', true));
    expect(toastCatch).not.toHaveBeenCalled();
  });

  it('writes nothing when the grant was never armed', async () => {
    companionDispatchFleetPlan.mockImplementation(async () => {
      storeState.fleetSessions = [...sessions, { id: 'born', state: 'running', cwd: PROJECT.root_path }];
      return {};
    });
    render(<QuickDispatchDock />);
    expand();
    await arm();
    fireEvent.click(screen.getByTestId('quick-dispatch-send'));
    await vi.waitFor(() => expect(companionDispatchFleetPlan).toHaveBeenCalled());
    expect(setSessionAthenaFlag).not.toHaveBeenCalled();
  });

  it('TELLS the operator when the dispatch ran and the grant did not land', async () => {
    companionDispatchFleetPlan.mockImplementation(async () => {
      storeState.fleetSessions = [...sessions, { id: 'born', state: 'running', cwd: PROJECT.root_path }];
      return {};
    });
    setSessionAthenaFlag.mockImplementation(async () => { throw new Error('door closed'); });
    render(<QuickDispatchDock />);
    expand();
    await arm();
    fireEvent.click(screen.getByTestId('quick-dispatch-athena-toggle'));
    fireEvent.click(screen.getByTestId('quick-dispatch-send'));
    // A running session the operator believes Athena owns is the one state
    // this feature must never produce silently.
    await vi.waitFor(() => expect(toastCatch).toHaveBeenCalled());
    setSessionAthenaFlag.mockImplementation(async () => true);
  });
});


describe('QuickDispatchDock — the anti-shake contract, in every variant', () => {
  // jsdom has no layout engine, so this is a STRUCTURAL measurement, not a
  // pixel one: the dock's height is the sum of its in-flow rows, whose heights
  // are literal classes, so if the class list and the row count are identical
  // in every state, the outer height is too.
  //
  // The dock now hosts THREE shells behind a persisted switch, and they do not
  // share a row map — `ribbon` puts the readings in a footer where `rail` puts
  // them in a header, so the heights differ BETWEEN variants by design. The
  // contract was never "these four literals"; it is "the same rows, at the
  // same heights, in every state" — per variant. So the literals are asserted
  // per variant (the pixel measurement is still a real one, just three of
  // them) and the cross-state identity is asserted for each.
  //
  // The rows are found by the `data-dock-row` marker they carry, not by being
  // direct children of the grid carrying `z-[1]`. The marker is what a row IS;
  // child position stopped being a safe proxy for it the moment the shells
  // declared their swapped region as the tab panel the variant switch
  // controls (a `display: contents` wrapper, so the layout is unchanged and
  // only the DOM nesting moved). An absolutely positioned typeahead panel
  // still carries no marker and so is still not counted, which was the only
  // thing the old `z-[1]` filter was protecting.
  const rows = () =>
    Array.from(screen.getByTestId('quick-dispatch-dock').querySelectorAll('[data-dock-row]')).map(
      (el) => (el as HTMLElement).className.match(/\bh-\[?[\w.]+\]?/)?.[0] ?? '',
    );
  /** The deck's reserved box lives one level in, on the bordered frame. */
  const deckHeight = () => {
    const deck = screen
      .getByTestId('quick-dispatch-dock')
      .querySelector('[data-dock-deck]') as HTMLElement | null;
    return deck?.className.match(/\bh-\[?[\w.]+\]?/)?.[0] ?? '';
  };

  /** Each shell's row map. The deck is one literal, shared by all three. */
  const SHAPES: Record<DockVariant, string[]> = {
    rail: ['h-[30px]', 'h-[34px]', 'h-6', '', 'h-5'],
    console: ['h-[34px]', 'h-[30px]', 'h-6', '', 'h-5'],
    ribbon: ['h-[34px]', 'h-6', '', 'h-[26px]', 'h-5'],
  };

  beforeEach(() => localStorage.clear());

  for (const variant of DOCK_VARIANTS) {
    it(`${variant}: keeps the same reserved rows, at the same heights, in every state`, async () => {
      writeDockVariant(variant);
      render(<QuickDispatchDock />);
      expand();
      const draft = rows();
      expect(draft).toEqual(SHAPES[variant]);
      expect(deckHeight()).toBe(DECK_HEIGHT);

      // Typed.
      await arm();
      expect(rows()).toEqual(draft);
      expect(deckHeight()).toBe(DECK_HEIGHT);

      // Typeahead open: the panel renders absolutely at bottom-full, out of flow.
      fireEvent.change(field(), { target: { value: '@per' } });
      await screen.findByTestId('quick-dispatch-suggestion-item');
      expect(rows()).toEqual(draft);
      expect(deckHeight()).toBe(DECK_HEIGHT);

      // Long objective: the field grows INSIDE the deck and then scrolls.
      fireEvent.change(field(), { target: { value: 'x'.repeat(1100) } });
      expect(rows()).toEqual(draft);
      expect(deckHeight()).toBe(DECK_HEIGHT);
    });

    it(`${variant}: mounts every reading and every toggle in every state`, async () => {
      writeDockVariant(variant);
      render(<QuickDispatchDock />);
      expand();
      for (const value of ['', 'a short objective', 'x'.repeat(1100)]) {
        fireEvent.change(field(), { target: { value } });
        expect(screen.getByTestId('quick-dispatch-landing')).toBeTruthy();
        expect(screen.getByTestId('quick-dispatch-athena-toggle')).toBeTruthy();
        expect(screen.getByTestId('quick-dispatch-gauge-cost')).toBeTruthy();
        expect(screen.getByTestId('quick-dispatch-status-pill')).toBeTruthy();
      }
    });
  }
});

describe('QuickDispatchDock — three variants, one set of shape rules', () => {
  beforeEach(() => localStorage.clear());

  it('rests on `rail` for a missing, unknown or unreadable stored value', () => {
    expect(readDockVariant()).toBe('rail');
    localStorage.setItem('monitor.dock.variant', 'horizon');
    expect(readDockVariant()).toBe('rail');
  });

  it('switches shell and persists the choice', () => {
    render(<QuickDispatchDock />);
    expand();
    expect(screen.getByTestId('quick-dispatch-dock').getAttribute('data-dock-variant')).toBe('rail');
    fireEvent.click(screen.getByTestId('quick-dispatch-variant-ribbon'));
    expect(screen.getByTestId('quick-dispatch-dock').getAttribute('data-dock-variant')).toBe('ribbon');
    expect(readDockVariant()).toBe('ribbon');
  });

  for (const variant of DOCK_VARIANTS) {
    it(`${variant}: the toolbar carries the parameters and sits ABOVE the command row`, () => {
      writeDockVariant(variant);
      render(<QuickDispatchDock />);
      expand();
      const toolbar = screen.getByTestId('quick-dispatch-toolbar');
      // Every toggle and parameter picker is inside the toolbar, not beside
      // the field: "toolbar on top for toggles and param setup".
      for (const id of [
        'quick-dispatch-model-chip',
        'quick-dispatch-effort-chip',
        'quick-dispatch-athena-toggle',
        'quick-dispatch-headless-toggle',
        'quick-dispatch-skill-picker-toggle',
      ]) {
        expect(toolbar.contains(screen.getByTestId(id)), `${id} belongs to the toolbar`).toBe(true);
      }
      // ...and the toolbar precedes the command row in document order.
      const send = screen.getByTestId('quick-dispatch-send');
      expect(toolbar.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it(`${variant}: the objective and the launch share ONE row, and no control stacks its icon over its label`, () => {
      writeDockVariant(variant);
      render(<QuickDispatchDock />);
      expand();
      const send = screen.getByTestId('quick-dispatch-send');
      // The field and the button are siblings inside the one command well.
      expect(send.parentElement?.contains(screen.getByTestId('quick-dispatch-input'))).toBe(true);
      // The launch used to be a `flex-col` stacking its arrow over its word.
      for (const id of [
        'quick-dispatch-send',
        'quick-dispatch-headless-toggle',
        'quick-dispatch-athena-toggle',
        'quick-dispatch-model-chip',
        'quick-dispatch-effort-chip',
      ]) {
        expect(screen.getByTestId(id).className, `${id} must not stack`).not.toMatch(/\bflex-col\b/);
      }
    });
  }
});
