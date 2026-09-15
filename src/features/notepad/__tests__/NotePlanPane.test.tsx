// The pane's SHAPE, which is the part the move could silently lose.
//
// Absorbing the Ship tab into the pad is a rehost, and a rehost's failure mode
// is not a crash — it is a surface that renders with half its readings missing
// and looks fine. So these pin the three things the layout is FOR: the brief
// and the scope are on screen together, the scope is reachable through three
// named views, and a shipped plan's brief is a record rather than an editor.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { ShipMilestoneVM } from '@/lib/milestone/shipModel';
import { ctx, feature, member, milestone } from '@/lib/milestone/__tests__/shipFixtures';

import type { NotePlanValue } from '../plan/NotePlanContext';
import { NotePlanPane } from '../plan/NotePlanPane';
import type { NoteActions } from '../notepadActions';

const auth = ctx('c-auth', 'auth', 'ok', 2, 0);

function vm(over: Partial<ShipMilestoneVM> = {}): ShipMilestoneVM {
  return {
    row: milestone(),
    id: 'ms-1',
    name: 'First ship',
    goal: 'Get the dock in front of a user',
    description: 'The brief lives on the note now.',
    status: 'planned',
    targetLabel: 'target 2026-10-01',
    members: [member(feature('f1', 'login', [auth]))],
    goalMembers: [],
    boundGoals: [],
    footprint: [auth],
    skillCoverage: [],
    criteria: [
      { id: 'objective', label: 'Objective bound', evidence: 'one goal bound', done: 1, total: 1, state: 'go' },
      { id: 'sensors', label: 'Sensors wired', evidence: 'monitoring not wired', done: 0, total: 1, state: 'warn' },
    ],
    progress: 50,
    duality: { rated: 0, unrated: 1, agree: 0, disagree: 0, conflicts: [] },
    ...over,
  };
}

/** The pane reads its milestone through the context the provider fills. Mocking
 *  it is what keeps this a LAYOUT test: no L2 fetch, no milestone IPC, no fleet. */
const planValue = (over: Partial<NotePlanValue> = {}): NotePlanValue => {
  const m = over.vm === undefined ? vm() : over.vm;
  return {
    ship: {
      loading: false,
      project: { id: 'p1', name: 'personas', root_path: '/repo' },
      roadmap: m ? [m] : [],
      contexts: [auth],
      groups: [],
      reload: vi.fn(),
      features: [],
      goals: [],
      create: vi.fn(),
      setStatus: vi.fn(),
      setGoal: vi.fn(),
      setDescription: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    } as unknown as NotePlanValue['ship'],
    vm: m,
    loading: false,
    verdict: 'warn',
    unmet: 1,
    totalCriteria: 2,
    execute: vi.fn().mockResolvedValue(undefined),
    executing: false,
    decompose: vi.fn(),
    openCertify: vi.fn(),
    editable: true,
    ...over,
  };
};

let current: NotePlanValue | null = planValue();
vi.mock('../plan/NotePlanContext', async () => {
  const actual = await vi.importActual<typeof import('../plan/NotePlanContext')>('../plan/NotePlanContext');
  return { ...actual, useNotePlan: () => current };
});

// The criteria list reaches into the passport's fleet-session store and opens
// its own modals; the Runs tab reads `dev_note_runs` over IPC. Neither is what
// this file is about — both have their own homes.
vi.mock('../plan/ShipCriteriaPanel', () => ({
  ShipCriteriaList: () => <div data-testid="ship-criteria-list" />,
}));
vi.mock('../plan/NotePlanRuns', () => ({
  NotePlanRuns: () => <div data-testid="note-runs-list" />,
}));

const note = (over: Partial<DevNote> = {}): DevNote =>
  ({
    id: 'n1',
    projectId: 'p1',
    milestoneId: 'ms-1',
    title: 'The dock',
    bodyMd: '# Brief\n\nShip the dock.',
    status: 'scoped',
    orderIndex: 0,
    dispatchTarget: null,
    dispatchKey: null,
    fleetSessionId: null,
    agentId: null,
    resultJson: null,
    publishedAt: null,
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-09-15T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
    ...over,
  }) as DevNote;

function pane(over: Partial<DevNote> = {}, readOnly = false) {
  const onPatch = vi.fn();
  render(
    <NotePlanPane
      note={note(over)}
      onPatch={onPatch}
      readOnly={readOnly}
      project={{ id: 'p1', name: 'personas', root_path: '/repo' } as never}
      suggestions={[]}
      actions={{} as NoteActions}
    />,
  );
  return { onPatch };
}

describe('NotePlanPane', () => {
  it('a scoped note shows the brief AND the scope, with three views of the scope', () => {
    current = planValue();
    pane();

    // The brief — an editable TEXTAREA, because a brief that freezes the moment
    // the scope is named is a brief nobody updates. (`MarkdownMiniEditor`
    // swaps the textarea for a rendered div when read-only, so the tag name is
    // the assertion, not a `readonly` attribute.)
    const body = screen.getByTestId('notepad-body-plan');
    expect(body.tagName).toBe('TEXTAREA');

    // The scope, under its own objective, with the cut on screen by default.
    expect(screen.getByTestId('note-plan-ledger')).toBeInTheDocument();
    expect(screen.getByTestId('note-plan-target')).toHaveTextContent('target 2026-10-01');

    for (const label of ['Plan', 'Criteria', 'Runs']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });

  it('switches the scope half without touching the brief', () => {
    current = planValue();
    pane();

    fireEvent.click(screen.getByRole('tab', { name: 'Criteria' }));
    expect(screen.getByTestId('ship-criteria-list')).toBeInTheDocument();
    expect(screen.queryByTestId('note-plan-ledger')).toBeNull();
    // The brief is the constant half — it is what the other half is measured
    // against, so it never goes away when the view changes.
    expect(screen.getByTestId('notepad-body-plan')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
    expect(screen.getByTestId('note-runs-list')).toBeInTheDocument();
    expect(screen.getByTestId('notepad-body-plan')).toBeInTheDocument();
  });

  it('a shipped note is a record: the brief is read-only and scope cannot be composed', () => {
    current = planValue({ editable: false, vm: vm({ status: 'shipped' }) });
    pane({ status: 'shipped' }, true);

    // Read-only renders the brief AS MARKDOWN, not as a disabled textarea — a
    // record should read like one.
    expect(screen.getByTestId('notepad-body-plan').tagName).not.toBe('TEXTAREA');
    expect(screen.queryByTestId('note-plan-compose')).toBeNull();
  });

  it('paints its chrome while the milestone is still loading, and ghosts only the scope', () => {
    current = planValue({ loading: true, vm: null });
    pane();

    // Law 1: the permanent chrome is never replaced by the loading state, and
    // the loading state is a geometry ghost — never a spinner.
    expect(screen.getByTestId('notepad-body-plan')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByTestId('note-plan-ghost')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says so when the link outlived its milestone, instead of drawing an empty plan', () => {
    current = planValue({ loading: false, vm: null });
    pane();

    expect(screen.getByTestId('note-plan-missing')).toBeInTheDocument();
    expect(screen.queryByTestId('note-plan-ledger')).toBeNull();
  });
});
