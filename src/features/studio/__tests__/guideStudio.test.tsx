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

  it('Esc tucks a sketch question away during the draft and your call brings it back', () => {
    useStudioStore.setState({
      draft: {
        name: 'Hearth', vision: 'A bakery', startedAt: Date.now(), sketchState: 'ready', answers: {},
        sketch: {
          summary: 'A bakery.', pages: [{ title: 'Home', route: '/', regions: [] }], goals: [],
          questions: [{ question: 'Pickup only?', options: ['Yes', 'No'], why: '' }],
        },
      },
    });
    mount();
    expect(screen.getByText('Pickup only?')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Pickup only?')).toBeNull();
    fireEvent.click(screen.getByText('your_call'));
    expect(screen.getByText('Pickup only?')).toBeTruthy();
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
    // The live region carries what she is doing, never the ticking clock, so a
    // screen reader is not re-read the line every second.
    expect(screen.getByRole('status').textContent).toBe('act_search: bakeries');
  });

  it('lists the notes waiting for her next step, and each can be taken back', () => {
    seed({ busy: true, turnStartedAt: Date.now(), queuedNotes: ['make it blue', 'bigger logo'] });
    mount();
    fireEvent.click(screen.getByText('notes_waiting'));
    expect(screen.getByText('make it blue')).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText('note_remove')[0]!);
    expect(useStudioStore.getState().runtimes.p1!.queuedNotes).toEqual(['bigger logo']);
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

  it('Enter takes the first next move only when nothing else has focus', () => {
    const phases = [
      { id: 'v', title: 'Vision', status: 'done', note: null },
      { id: 'm', title: 'Menu', status: 'active', note: null },
    ];
    seed({ phases, turnDurations: [400], activity: [{ id: 'a', kind: 'build', subject: 'Menu grid', detail: 'Write', ts: 0 }] });
    mount();
    expect(screen.getByText('card_continue')).toBeTruthy();
    const goal = document.querySelector<HTMLElement>('[data-active="true"]')!;
    goal.focus();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(useStudioStore.getState().runtimes.p1!.busy).toBe(false);
    goal.blur();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(useStudioStore.getState().runtimes.p1!.busy).toBe(true);
  });

  it('the tool arc is a real menu: focus moves into it, unavailable tools say why, Esc returns focus', () => {
    seed({});
    mount();
    const orb = screen.getByLabelText('tools_open');
    expect(orb.getAttribute('aria-haspopup')).toBe('menu');
    orb.focus();
    fireEvent.keyDown(window, { key: 'o' });
    const menu = screen.getByRole('menu');
    expect(orb.getAttribute('aria-expanded')).toBe('true');
    // Only menu items live inside the menu (the backdrop is outside it).
    expect(menu.querySelectorAll('button:not([role="menuitem"])')).toHaveLength(0);
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(items[1]);
    // An unavailable tool stays focusable and names its reason.
    const tweak = items.find((b) => b.textContent?.includes('tool_tweak'))!;
    expect(tweak.getAttribute('aria-disabled')).toBe('true');
    const why = document.getElementById(tweak.getAttribute('aria-describedby')!);
    expect(why?.textContent).toBe('tool_soon');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(orb);
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
