import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// The dock's Plan | App switch (what the main frame shows, the plan sheet or
// the running app; App waits for a live preview) and its goals button, which
// shows or hides the goals rail.

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: new Proxy({}, { get: () => new Proxy({}, { get: (_, k) => String(k) }) }),
    tx: (s: string) => s,
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: () => Promise.resolve(null) }));
vi.mock('../StudioBuildSettings', () => ({ default: () => null }));
vi.mock('../StudioMessages', () => ({ default: () => null }));

const { useStudioStore } = await import('../studioStore');
const StudioChatInput = (await import('../StudioChatInput')).default;

type RT = ReturnType<typeof useStudioStore.getState>['runtimes'][string];
function seed() {
  const rt = {
    id: 'p1', name: 'Hearth', phase: 'live', status: null, phases: [], busy: false, stream: '',
    reply: null, messages: [], question: null, autonomous: false, autoTurns: 0, resumeAuto: false,
    effort: 'xhigh', style: 'balanced', options: [], decisionArea: null, decisionSelector: null,
    gatePlan: false, mcp: [], stopNoop: false, activity: [], turnStartedAt: null, turnDurations: [],
    queuedNotes: [],
  } as unknown as RT; // test fixture: only the fields the dock reads are meaningful
  useStudioStore.setState({ runtimes: { p1: rt }, tabOrder: ['p1'], activeId: 'p1' });
}

afterEach(() => {
  cleanup();
  useStudioStore.setState({ runtimes: {}, tabOrder: [], activeId: null });
});

describe('dock frame view switch', () => {
  it('draws neither control when it is handed neither', () => {
    seed();
    render(<StudioChatInput />);
    expect(screen.queryByTestId('studio-view-plan')).toBeNull();
    expect(screen.queryByTestId('studio-plan-button')).toBeNull();
  });

  it('every control sits on the toolbar; the input row is the field and Send alone', () => {
    seed();
    render(<StudioChatInput goals={{ open: true, onToggle: () => {} }} view={{ showing: 'app', appReady: true, onChange: () => {} }} />);
    const toolbar = screen.getByTestId('studio-dock-toolbar');
    for (const id of ['studio-view-plan', 'studio-view-app', 'studio-plan-button']) {
      expect(toolbar.contains(screen.getByTestId(id))).toBe(true);
    }
    const field = screen.getByTestId('studio-chat-input');
    const row = field.parentElement!;
    expect(row.contains(toolbar)).toBe(false);
    // One button in the input row: Send.
    expect(row.querySelectorAll('button')).toHaveLength(1);
  });

  it('the goals button reports the rail state and toggles it', () => {
    seed();
    const onToggle = vi.fn();
    const { rerender } = render(<StudioChatInput goals={{ open: true, onToggle }} />);
    const btn = screen.getByTestId('studio-plan-button');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<StudioChatInput goals={{ open: false, onToggle }} />);
    expect(screen.getByTestId('studio-plan-button').getAttribute('aria-expanded')).toBe('false');
  });

  it('marks the shown side and reports a switch', () => {
    seed();
    const onChange = vi.fn();
    render(<StudioChatInput view={{ showing: 'plan', appReady: true, onChange }} />);
    expect(screen.getByTestId('studio-view-plan').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('studio-view-app').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('studio-view-app'));
    expect(onChange).toHaveBeenCalledWith('app');
  });

  it('holds App back until the preview is live', () => {
    seed();
    const onChange = vi.fn();
    render(<StudioChatInput view={{ showing: 'plan', appReady: false, onChange }} />);
    const app = screen.getByTestId('studio-view-app') as HTMLButtonElement;
    expect(app.disabled).toBe(true);
    fireEvent.click(app);
    expect(onChange).not.toHaveBeenCalled();
  });
});
