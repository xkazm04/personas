import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Classic shows its dock whenever there is a turn to watch or stop, not only
// once the preview is live: the first build turn starts while the dev server
// is still booting, and without the dock there is no Stop for it.

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: new Proxy({}, { get: () => new Proxy({}, { get: (_, k) => String(k) }) }),
    tx: (s: string) => s,
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('@/api/webbuild', () => ({
  webbuildListRoutes: () => Promise.resolve(['/']),
  webbuildListProjects: () => Promise.resolve([]),
}));
vi.mock('../StudioChatInput', () => ({ default: () => <div data-testid="dock" /> }));
vi.mock('../StudioVersions', () => ({ default: () => null }));
vi.mock('../StudioVisionStart', () => ({ default: () => <div data-testid="vision" /> }));

const { useStudioStore } = await import('../studioStore');
const StudioCurrentLayout = (await import('../StudioCurrentLayout')).default;

type RT = ReturnType<typeof useStudioStore.getState>['runtimes'][string];
function seed(p: Partial<RT>) {
  const rt = {
    id: 'p1', name: 'Hearth', phase: 'starting', status: null, phases: [], busy: false, stream: '',
    reply: null, messages: [], question: null, autonomous: false, autoTurns: 0, resumeAuto: false,
    effort: 'xhigh', style: 'balanced', options: [], decisionArea: null, decisionSelector: null,
    gatePlan: false, mcp: [], stopNoop: false, activity: [], turnStartedAt: null, turnDurations: [],
    queuedNotes: [], ...p,
  } as RT;
  useStudioStore.setState({ runtimes: { p1: rt }, tabOrder: ['p1'], activeId: 'p1' });
}
const mount = () => render(<StudioCurrentLayout showVision={false} submitting={false} onCreate={async () => {}} />);

afterEach(() => {
  cleanup();
  useStudioStore.setState({ runtimes: {}, tabOrder: [], activeId: null });
});

describe('Classic dock', () => {
  it('is there while the first turn runs before the preview is live', () => {
    seed({ busy: true, turnStartedAt: Date.now() });
    mount();
    expect(screen.getByTestId('dock')).toBeTruthy();
    expect(screen.getByText('starting')).toBeTruthy();
  });

  it('stays hidden while an idle project boots', () => {
    seed({});
    mount();
    expect(screen.queryByTestId('dock')).toBeNull();
  });
});
