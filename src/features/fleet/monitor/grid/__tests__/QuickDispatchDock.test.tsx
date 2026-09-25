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
vi.mock('@/api/companion', () => ({ companionDispatchFleetPlan: vi.fn(async () => ({})) }));
vi.mock('@/api/fleet/fleet', () => ({
  renameSession: vi.fn(async () => undefined),
  spawnHeadlessSession: vi.fn(async () => ({})),
}));

// The board snapshot the resting row reports on. Two sessions that need the
// operator, one working — the lanes come from `laneOfState`.
const sessions = [
  { id: 'a', state: 'awaiting_input' },
  { id: 'b', state: 'stale' },
  { id: 'c', state: 'running' },
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
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: unknown) => unknown) => selector(storeState),
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
