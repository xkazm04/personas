/**
 * The dispatch panel, end to end through the real shared table and the real
 * English strings.
 *
 * The claims worth pinning are the honest ones: the panel reads the ONE
 * `dev_ideas` path rather than opening a second, it says why Fleet cannot take
 * an idea BEFORE the click, and it never lets a half-worked dispatch read as a
 * success — every `skipped[]` entry the backend returns is on screen with its
 * own reason.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';
import type { AttentionThresholds } from '@/lib/bindings/AttentionThresholds';
import type { DispatchIdeasResult } from '@/lib/bindings/DispatchIdeasResult';

// --- mocks (declared before the import under test) -------------------------

const dispatchIdeas = vi.fn<(ids: string[], target: string) => Promise<DispatchIdeasResult>>();
const fetchTriageIdeas = vi.fn();
const refreshUndispatchedIdeas = vi.fn();
const refreshDispatchThresholds = vi.fn();

const thresholds: AttentionThresholds = {
  staleGoalDays: 7, ideaDispatchDays: 3, taskRunningHours: 4, taskQueuedHours: 24,
};

const systemState = {
  triageItems: [] as DevIdea[],
  triageCounts: null,
  triageHasMore: false,
  triageLoading: false,
  triageLoadingMore: false,
  fetchTriageIdeas,
  fetchMoreTriageIdeas: vi.fn(),
  acceptIdea: vi.fn(),
  rejectIdea: vi.fn(),
  deleteTriageIdea: vi.fn(),
  projects: [] as DevProject[],
  undispatchedIdeas: null as UndispatchedIdea[] | null,
  dispatchThresholds: null as AttentionThresholds | null,
  refreshUndispatchedIdeas,
  refreshDispatchThresholds,
  lastTriageQuery: null as { projectId?: string; query?: { status?: string } } | null,
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof systemState) => unknown) => sel(systemState),
}));

vi.mock('@/api/devTools/devTools', () => ({
  dispatchIdeas: (ids: string[], target: string) => dispatchIdeas(ids, target),
}));

import { DispatchPanel } from '../DispatchPanel';

// --- fixtures --------------------------------------------------------------

function devIdea(over: Partial<DevIdea> = {}): DevIdea {
  return {
    id: 'i1', project_id: 'p1', context_id: null, scan_type: 'scan', category: 'technical',
    title: 'Idea one', description: null, reasoning: null, status: 'accepted',
    effort: null, impact: null, risk: null, priority: null, provider: null, model: null,
    rejection_reason: null, origin: null, use_case_id: null, evidence: null, dedup_key: null,
    verify_state: null, verify_checked_at: null, verify_evidence: null,
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}

function project(over: Partial<DevProject> = {}): DevProject {
  return {
    id: 'p1', name: 'Alpha', root_path: 'C:/repos/alpha', description: null, status: 'active',
    tech_stack: null, github_url: null, monitoring_credential_id: null,
    monitoring_project_slug: null, static_scan_config: null, auto_pr_on_success: false,
    pr_credential_id: null, llm_tracking_credential_id: null, support_credential_id: null,
    data_links: null, test_env_url: null, test_env_branch: null, main_branch: null,
    standards_config: null, team_id: null, workspace_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function undispatched(over: Partial<UndispatchedIdea> = {}): UndispatchedIdea {
  return {
    id: 'i1', title: 'Idea one', projectId: 'p1', projectName: 'Alpha', category: 'technical',
    origin: null, priority: null, impact: null, effort: null,
    acceptedAt: '2026-08-01T00:00:00Z', ageHours: 100,
    ...over,
  };
}

function result(over: Partial<DispatchIdeasResult> = {}): DispatchIdeasResult {
  return { target: 'runner', dispatched: [], skipped: [], started: true, ...over };
}

const dispatched = (ideaId: string) => ({
  ideaId, taskId: `t-${ideaId}`, title: ideaId, projectId: 'p1', projectName: 'Alpha',
  rootPath: 'C:/repos/alpha', prompt: 'do it',
});

beforeEach(() => {
  vi.clearAllMocks();
  systemState.triageItems = [];
  systemState.projects = [project()];
  systemState.undispatchedIdeas = null;
  systemState.dispatchThresholds = null;
  systemState.lastTriageQuery = null;
  dispatchIdeas.mockResolvedValue(result());
});

afterEach(cleanup);

/** Select a row by its title — the checkbox's own accessible name. */
async function selectRow(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: `Select ${title}` }));
}

// --- tests -----------------------------------------------------------------

describe('the panel reads the one approved queue, grouped by project', () => {
  it('opens the shared queue on `accepted` — not a second dev_ideas fetch', () => {
    render(<DispatchPanel onClose={() => {}} />);

    expect(fetchTriageIdeas).toHaveBeenCalledTimes(1);
    const [projectId, query] = fetchTriageIdeas.mock.calls[0] as [
      string | undefined,
      { status: string },
    ];
    expect(projectId).toBeUndefined();      // cross-project, like the Backlog
    expect(query.status).toBe('accepted');  // things already decided
  });

  it('groups the rail by project, because that is what a dispatch targets', () => {
    systemState.triageItems = [
      devIdea({ id: 'a', title: 'Alpha work', project_id: 'p1' }),
      devIdea({ id: 'b', title: 'Beta work', project_id: 'p2' }),
    ];
    systemState.projects = [project(), project({ id: 'p2', name: 'Beta', root_path: '' })];

    render(<DispatchPanel onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /^Alpha/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Beta/ })).toBeTruthy();
  });

  it('puts a project-less idea in its own bucket, not silently at the root', () => {
    systemState.triageItems = [devIdea({ id: 'a', title: 'Homeless', project_id: null })];

    render(<DispatchPanel onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /^No project/ })).toBeTruthy();
  });

  it('restores the query the shared list was serving when it closes', () => {
    // `triageItems` is ONE list. Narrowing it to `accepted` and walking away
    // would leave the Backlog filtering the wrong bucket and rendering empty.
    systemState.lastTriageQuery = { projectId: undefined, query: { status: 'pending' } };

    const { unmount } = render(<DispatchPanel onClose={() => {}} />);
    fetchTriageIdeas.mockClear();
    unmount();

    expect(fetchTriageIdeas).toHaveBeenCalledWith(undefined, { status: 'pending' });
  });
});

describe('never-dispatched rows are distinct, and their age is the backend’s', () => {
  it('flags the approved ideas with no task and leaves the rest alone', () => {
    systemState.triageItems = [
      devIdea({ id: 'a', title: 'Waiting one' }),
      devIdea({ id: 'b', title: 'Already sent' }),
    ];
    systemState.undispatchedIdeas = [undispatched({ id: 'a', title: 'Waiting one' })];

    render(<DispatchPanel onClose={() => {}} />);

    expect(screen.getByTestId('dispatch-row-undispatched-a')).toBeTruthy();
    expect(screen.queryByTestId('dispatch-row-undispatched-b')).toBeNull();
    // Glyph + word, not colour alone.
    expect(screen.getByTestId('dispatch-row-undispatched-a').textContent).toContain('Never dispatched');
  });

  it('shows an undispatched idea the approved page never loaded', () => {
    systemState.triageItems = [];
    systemState.undispatchedIdeas = [undispatched({ id: 'z', title: 'Forgotten entirely' })];

    render(<DispatchPanel onClose={() => {}} />);

    expect(screen.getByText('Forgotten entirely')).toBeTruthy();
  });

  it('names the staleness threshold the backend actually applied', () => {
    systemState.triageItems = [devIdea({ id: 'a', title: 'Old one' })];
    systemState.undispatchedIdeas = [undispatched({ id: 'a', title: 'Old one', ageHours: 200 })];
    systemState.dispatchThresholds = thresholds;

    render(<DispatchPanel onClose={() => {}} />);

    // 3 days is the echoed `ideaDispatchDays`, not a constant in this file.
    expect(screen.getByTestId('dispatch-summary').textContent).toContain('longer than 3 days');
    expect(screen.getByTestId('dispatch-row-undispatched-a').textContent).toContain('over 3 days');
  });

  it('claims nothing about staleness before the thresholds are read', () => {
    systemState.triageItems = [devIdea({ id: 'a', title: 'Old one' })];
    systemState.undispatchedIdeas = [undispatched({ id: 'a', title: 'Old one', ageHours: 9999 })];
    systemState.dispatchThresholds = null;

    render(<DispatchPanel onClose={() => {}} />);

    expect(screen.getByTestId('dispatch-summary').textContent).not.toContain('longer than');
    expect(screen.getByTestId('dispatch-row-undispatched-a').textContent).toBe('Never dispatched');
  });
});

describe('a project with no folder cannot be handed to Fleet', () => {
  beforeEach(() => {
    systemState.triageItems = [devIdea({ id: 'a', title: 'Pathless work', project_id: 'p2' })];
    systemState.projects = [project({ id: 'p2', name: 'Beta', root_path: '   ' })];
  });

  it('says why before the click, and disables the action', async () => {
    const user = userEvent.setup();
    render(<DispatchPanel onClose={() => {}} />);
    await selectRow(user, 'Pathless work');

    expect(screen.getByTestId('dispatch-fleet-blocked').textContent).toContain(
      'Fleet works inside a project folder',
    );
    expect(screen.getByTestId('dispatch-to-fleet')).toBeDisabled();
    // The runner does not need a folder, so it stays available.
    expect(screen.getByTestId('dispatch-to-runner')).not.toBeDisabled();
  });

  it('does not warn about a project that has one', async () => {
    systemState.triageItems = [devIdea({ id: 'a', title: 'Fine work', project_id: 'p1' })];
    systemState.projects = [project()];
    const user = userEvent.setup();

    render(<DispatchPanel onClose={() => {}} />);
    await selectRow(user, 'Fine work');

    expect(screen.queryByTestId('dispatch-fleet-blocked')).toBeNull();
    expect(screen.getByTestId('dispatch-to-fleet')).not.toBeDisabled();
  });
});

describe('both targets are reachable, and the call says which', () => {
  beforeEach(() => {
    systemState.triageItems = [devIdea({ id: 'a', title: 'Ready work' })];
  });

  it('dispatches the selection to the runner', async () => {
    const user = userEvent.setup();
    dispatchIdeas.mockResolvedValue(result({ target: 'runner', dispatched: [dispatched('a')] }));

    render(<DispatchPanel onClose={() => {}} />);
    await selectRow(user, 'Ready work');
    await user.click(screen.getByTestId('dispatch-to-runner'));

    await waitFor(() => expect(dispatchIdeas).toHaveBeenCalledWith(['a'], 'runner'));
  });

  it('dispatches the selection to Fleet — the arm that had no caller until now', async () => {
    const user = userEvent.setup();
    dispatchIdeas.mockResolvedValue(result({ target: 'fleet', dispatched: [dispatched('a')] }));

    render(<DispatchPanel onClose={() => {}} />);
    await selectRow(user, 'Ready work');
    await user.click(screen.getByTestId('dispatch-to-fleet'));

    await waitFor(() => expect(dispatchIdeas).toHaveBeenCalledWith(['a'], 'fleet'));
  });

  it('re-reads the undispatched signal so the badge cannot go stale', async () => {
    const user = userEvent.setup();
    dispatchIdeas.mockResolvedValue(result({ dispatched: [dispatched('a')] }));

    render(<DispatchPanel onClose={() => {}} />);
    refreshUndispatchedIdeas.mockClear();
    await selectRow(user, 'Ready work');
    await user.click(screen.getByTestId('dispatch-to-runner'));

    await waitFor(() => expect(refreshUndispatchedIdeas).toHaveBeenCalled());
  });
});

describe('the panel reports what the dispatch actually did', () => {
  beforeEach(() => {
    systemState.triageItems = [
      devIdea({ id: 'a', title: 'First' }),
      devIdea({ id: 'b', title: 'Second' }),
    ];
  });

  it('reads as success only when nothing was skipped', async () => {
    const user = userEvent.setup();
    dispatchIdeas.mockResolvedValue(result({ dispatched: [dispatched('a')] }));

    render(<DispatchPanel onClose={() => {}} />);
    await selectRow(user, 'First');
    await user.click(screen.getByTestId('dispatch-to-runner'));

    const report = await screen.findByTestId('dispatch-result');
    expect(report.getAttribute('data-tone')).toBe('success');
    expect(report.textContent).toContain('1 sent');
  });

  it('surfaces EVERY skip with the backend’s own reason', async () => {
    const user = userEvent.setup();
    dispatchIdeas.mockResolvedValue(result({
      dispatched: [dispatched('a')],
      skipped: [
        { ideaId: 'b', reason: 'project has no root_path — cannot spawn a fleet session' },
        { ideaId: 'ghost', reason: 'not found' },
      ],
    }));

    render(<DispatchPanel onClose={() => {}} />);
    await selectRow(user, 'First');
    await user.click(screen.getByTestId('dispatch-to-runner'));

    const report = await screen.findByTestId('dispatch-result');
    // Not "success" — a dispatch that half-worked must not read as one.
    expect(report.getAttribute('data-tone')).toBe('partial');
    expect(report.textContent).toContain('1 sent, 2 skipped');
    // The skipped row resolves back to the idea the user selected...
    expect(screen.getByTestId('dispatch-skip-b').textContent).toContain('Second');
    expect(screen.getByTestId('dispatch-skip-b').textContent).toContain('no root_path');
    // ...and an id with no row still gets reported rather than dropped.
    expect(screen.getByTestId('dispatch-skip-ghost').textContent).toContain('not found');
  });

  it('reports a failed call instead of silently doing nothing', async () => {
    const user = userEvent.setup();
    dispatchIdeas.mockRejectedValue(new Error('Nothing could be dispatched — see the per-item reasons.'));

    render(<DispatchPanel onClose={() => {}} />);
    await selectRow(user, 'First');
    await user.click(screen.getByTestId('dispatch-to-runner'));

    const report = await screen.findByTestId('dispatch-result');
    expect(report.getAttribute('data-tone')).toBe('error');
  });
});
