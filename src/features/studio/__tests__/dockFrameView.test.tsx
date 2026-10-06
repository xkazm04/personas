import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// The dock's Plan | App switch: what Guide's main frame shows, the plan sheet
// or the running app. It only appears where a layout hands it a view, and App
// waits for a live preview.

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: new Proxy({}, { get: () => new Proxy({}, { get: (_, k) => String(k) }) }),
    tx: (s: string) => s,
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: () => Promise.resolve(null) }));
vi.mock('../StudioBuildSettings', () => ({ default: () => null }));
vi.mock('../StudioPlanDrawer', () => ({ default: () => null }));
vi.mock('../StudioMessages', () => ({ default: () => null }));
vi.mock('../StudioQuickActions', () => ({ default: () => null }));

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
  it('is absent when the layout passes no view (Classic)', () => {
    seed();
    render(<StudioChatInput />);
    expect(screen.queryByTestId('studio-view-plan')).toBeNull();
  });

  it('marks the shown side and reports a switch', () => {
    seed();
    const onChange = vi.fn();
    render(<StudioChatInput variant="guide" view={{ showing: 'plan', appReady: true, onChange }} />);
    expect(screen.getByTestId('studio-view-plan').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('studio-view-app').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('studio-view-app'));
    expect(onChange).toHaveBeenCalledWith('app');
  });

  it('holds App back until the preview is live', () => {
    seed();
    const onChange = vi.fn();
    render(<StudioChatInput variant="guide" view={{ showing: 'plan', appReady: false, onChange }} />);
    const app = screen.getByTestId('studio-view-app') as HTMLButtonElement;
    expect(app.disabled).toBe(true);
    fireEvent.click(app);
    expect(onChange).not.toHaveBeenCalled();
  });
});
