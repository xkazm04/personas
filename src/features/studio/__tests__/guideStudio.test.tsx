import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// Smoke-mounts the Guide layout on the real store in every state it renders:
// setting up, planning on the blueprint, a question, the next-move deck, and the
// tool arc. Copy is keyed (the i18n mock returns key names), so each assertion
// names the branch it proves.

const strings = (): Record<string, string> => new Proxy({}, { get: (_, k) => String(k) });
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: new Proxy({}, { get: () => new Proxy({}, { get: (_, k) => (k === 'guide' ? strings() : String(k)) }) }),
    tx: (s: string) => s,
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('@/api/webbuild', () => ({
  webbuildListRoutes: () => Promise.resolve(['/']),
  webbuildListProjects: () => Promise.resolve([]),
  webbuildSessionSend: vi.fn(() => new Promise(() => {})),
  webbuildSketch: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/features/plugins/companion/useTtsVoiceSelection', () => ({
  useTtsVoiceSelection: () => ({ engine: 'kokoro', voiceId: null, credentialId: null, configured: false }),
}));
vi.mock('@/features/plugins/companion/useTtsSettings', () => ({ useTtsSettings: () => undefined }));
vi.mock('../StudioChatInput', () => ({ default: () => <div data-testid="dock" /> }));
vi.mock('../StudioVersions', () => ({ default: () => null }));
vi.mock('../StudioVisionStart', () => ({ default: () => <div data-testid="vision" /> }));

const { useStudioStore } = await import('../studioStore');
const { MOCK_PHASES } = await import('../studioBuildModel');
const GuideStudio = (await import('../guide/GuideStudio')).default;

type RT = ReturnType<typeof useStudioStore.getState>['runtimes'][string];
function seed(p: Partial<RT>) {
  const rt = {
    id: 'p1', name: 'Hearth', phase: 'live', status: { healthy: true, url: 'http://localhost:5000' },
    phases: MOCK_PHASES, busy: false, stream: '', reply: null, messages: [], question: null,
    autonomous: false, autoTurns: 0, resumeAuto: false, effort: 'xhigh', style: 'balanced',
    options: [], decisionArea: null, decisionSelector: null, gatePlan: false, mcp: [], stopNoop: false,
    activity: [], turnStartedAt: null, turnDurations: [], queuedNotes: [], ...p,
  } as RT;
  useStudioStore.setState({ runtimes: { p1: rt }, tabOrder: ['p1'], activeId: 'p1' });
}
const mount = () => render(<GuideStudio showVision={false} submitting={false} onCreate={async () => {}} />);

afterEach(() => {
  cleanup();
  useStudioStore.setState({ runtimes: {}, tabOrder: [], activeId: null, draft: null });
});

describe('Guide layout', () => {
  it('draws the setup sheet while the project is being created', () => {
    seed({ phase: 'starting', status: null });
    mount();
    // No plan and no sketch yet: the Next.js page template, never a skeleton.
    expect(screen.getByText('template_home')).toBeTruthy();
    expect(screen.getByText('template_region_banner')).toBeTruthy();
    expect(screen.getByText('frame_blueprint')).toBeTruthy();
    // The dock is open during setup: notes left now go with the next step.
    expect(screen.getByTestId('dock')).toBeTruthy();
  });

  it('draws the sketch and asks its questions while the project is still being created', () => {
    useStudioStore.setState({
      draft: {
        name: 'Hearth',
        vision: 'A bakery',
        startedAt: Date.now() - 20_000,
        sketchState: 'ready',
        answers: {},
        sketch: {
          summary: 'A bakery that takes pickup orders.',
          pages: [{ title: 'Home', route: '/', regions: [{ title: 'Top bar', purpose: 'brand and ordering' }] }],
          goals: [{ title: 'Daily menu', note: 'prices' }],
          questions: [{ question: 'Pickup only?', options: ['Yes', 'Delivery too'], why: 'business model' }],
        },
      },
    });
    mount();
    expect(screen.getByText('Top bar')).toBeTruthy();
    expect(screen.getByText('A bakery that takes pickup orders.')).toBeTruthy();
    expect(screen.getByText('Daily menu')).toBeTruthy();
    expect(screen.getByText('setup_step_create')).toBeTruthy();
    fireEvent.click(screen.getByText('Yes'));
    expect(useStudioStore.getState().draft?.answers[0]).toBe('Yes');
  });

  it('replays a stored plan while an opened project boots', () => {
    seed({
      phase: 'starting',
      status: null,
      phases: [
        { id: 'v', title: 'Vision', status: 'done', note: 'shop + ordering' },
        { id: 'm', title: 'Menu', status: 'active', note: null },
      ],
    });
    mount();
    expect(screen.getByText('preview_booting_plan')).toBeTruthy();
    expect(screen.getAllByText('Menu').length).toBeGreaterThan(0);
    expect(screen.queryByText('template_home')).toBeNull();
  });

  it('an opened project replays its stored sketch without asking its questions again', () => {
    seed({
      phases: [],
      sketchState: 'ready',
      sketchAnswers: {},
      setupStartedAt: null,
      sketch: {
        summary: 'A bakery.',
        pages: [{ title: 'Home', route: '/', regions: [] }],
        goals: [],
        questions: [{ question: 'Pickup only?', options: ['Yes', 'No'], why: '' }],
      },
    });
    mount();
    expect(screen.queryByText('Pickup only?')).toBeNull();
  });

  it('while a new project is drafted, the tools and goals cannot act on the project behind it', () => {
    // activeId still names the previous (live) project during a draft.
    seed({ phases: [{ id: 'm', title: 'Menu', status: 'active', note: null }] });
    useStudioStore.setState({
      draft: { name: 'B', vision: 'x', startedAt: Date.now(), sketchState: 'loading', answers: {}, sketch: null },
    });
    mount();
    fireEvent.keyDown(window, { key: 'o' });
    expect(screen.queryByRole('menu')).toBeNull();
    const add = screen.getByText('add_goal').closest('button') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.queryByPlaceholderText('add_goal_placeholder')).toBeNull();
  });

  it('never holds a loading sheet over an idle project with no plan', () => {
    // Measured live 2026-09-24: an idle live project with no plan kept its
    // drafting ghosts forever over a running site, which read as frozen.
    seed({});
    mount();
    expect(screen.getByText('goals_none')).toBeTruthy();
    expect(screen.queryByText('goals_drafting')).toBeNull();
    expect(screen.queryByText('frame_blueprint')).toBeNull();
    expect(screen.getByText('frame_live')).toBeTruthy();
  });

  it('shows plain activity and honest time while she plans', () => {
    seed({ busy: true, turnStartedAt: Date.now() - 65_000, activity: [{ id: 'a', kind: 'search', subject: 'bakeries', detail: 'WebSearch', ts: 0 }] });
    mount();
    expect(screen.getByText('act_search: bakeries')).toBeTruthy();
    expect(screen.getByText('goals_drafting')).toBeTruthy();
    expect(screen.getByTestId('dock')).toBeTruthy();
  });

  it('asks the question on a large card with keyed options', () => {
    const phases = [
      { id: 'v', title: 'Vision', status: 'active', note: 'shop + ordering' },
      { id: 'm', title: 'Menu', status: 'pending', note: null },
    ];
    seed({ phases, question: 'Approve this plan?', options: ['Build it', 'Let me adjust'], messages: [{ id: 'm1', text: 'Here is the plan.', ts: 0 }], turnDurations: [372] });
    mount();
    expect(screen.getByText('Approve this plan?')).toBeTruthy();
    expect(screen.getByText('Build it')).toBeTruthy();
    expect(screen.getAllByText('Here is the plan.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('shop + ordering').length).toBeGreaterThan(0);
  });

  it('deals next moves after a finished step and opens the tool arc on O', () => {
    const phases = [
      { id: 'v', title: 'Vision', status: 'done', note: null },
      { id: 'f', title: 'Foundation', status: 'done', note: null },
      { id: 'm', title: 'Menu', status: 'active', note: null },
    ];
    seed({ phases, turnDurations: [400, 500], activity: [{ id: 'a', kind: 'build', subject: 'Menu grid', detail: 'Write', ts: 0 }] });
    mount();
    expect(screen.getByText('card_continue')).toBeTruthy();
    expect(screen.getByText('card_devices')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'o' });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(7);
  });
});
