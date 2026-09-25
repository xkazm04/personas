import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// Right-click targeting, host side: the composer next to the picked element
// and the note it sends. The agent side is previewAgent.test, the frame
// attribution is previewLocate.test.

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: new Proxy({}, { get: () => new Proxy({}, { get: (_, k) => (k === 'guide' ? new Proxy({}, { get: (_, kk) => String(kk) }) : String(k)) }) }),
    tx: (s: string) => s,
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
const send = vi.hoisted(() => vi.fn((..._a: unknown[]) => new Promise(() => {})));
vi.mock('@/api/webbuild', () => ({ webbuildSessionSend: send, webbuildListProjects: () => Promise.resolve([]) }));

const { useStudioStore, QUEUED_NOTES_MAX } = await import('../studioStore');
const { aimedNote } = await import('../studioSeed');
const StudioPickComposer = (await import('../StudioPickComposer')).default;

type RT = ReturnType<typeof useStudioStore.getState>['runtimes'][string];
const PICK = { projectId: 'p1', selector: '.pricing h3', label: 'Pro $19', tag: 'h3', component: null, chain: ['Pricing', 'PricingCard', 'h3'], rect: { x: 40, y: 300, width: 200, height: 30 }, path: '/pricing' };
function seed(p: Partial<RT> = {}) {
  useStudioStore.setState({
    runtimes: {
      p1: {
        id: 'p1', name: 'Hearth', phase: 'live', status: { healthy: true, url: 'http://localhost:5000' }, phases: [], busy: false,
        autonomous: false, question: null, messages: [], queuedNotes: [], gatePlan: false, activity: [], turnDurations: [], ...p,
      } as unknown as RT,
    },
    tabOrder: ['p1'],
    activeId: 'p1',
  });
}
function preview(over: Record<string, unknown> = {}) {
  return { pick: PICK, clearPick: vi.fn(), picking: false, startPickMode: vi.fn(), moveInspect: vi.fn(), activeId: 'p1', live: true, ...over } as never;
}

afterEach(() => {
  cleanup();
  send.mockClear();
  useStudioStore.setState({ runtimes: {}, tabOrder: [], activeId: null });
});

describe('aimed notes', () => {
  it('carry the page, the element as the owner saw it, and the selector', () => {
    const note = aimedNote({ selector: '.pricing h3', label: 'Pro $19', path: '/pricing' }, 'make this the highlighted plan');
    expect(note).toContain('/pricing');
    expect(note).toContain('"Pro $19"');
    expect(note).toContain('.pricing h3');
    expect(note).toContain('make this the highlighted plan');
  });

  it('go now when she is idle and wait as a note while she works', () => {
    seed();
    expect(useStudioStore.getState().sendAimed('p1', PICK, 'bigger')).toBe('sent');
    expect(String(send.mock.calls[0]?.[1])).toContain('.pricing h3');
    seed({ busy: true });
    expect(useStudioStore.getState().sendAimed('p1', PICK, 'bigger')).toBe('queued');
    expect(useStudioStore.getState().runtimes.p1!.queuedNotes[0]).toContain('"Pro $19"');
    seed({ busy: true, queuedNotes: Array.from({ length: QUEUED_NOTES_MAX }, (_, i) => `n${i}`) });
    expect(useStudioStore.getState().sendAimed('p1', PICK, 'bigger')).toBe('full');
  });
});

describe('the pick composer', () => {
  it('opens next to the picked element and sends what the owner types', () => {
    seed();
    const p = preview();
    render(<StudioPickComposer preview={p} />);
    expect(screen.getByText('"Pro $19" · /pricing')).toBeTruthy();
    const input = screen.getByTestId('studio-pick-input');
    fireEvent.change(input, { target: { value: 'make this the highlighted plan' } });
    fireEvent.submit(input.closest('form')!);
    expect(String(send.mock.calls[0]?.[1])).toContain('make this the highlighted plan');
    expect((p as unknown as { clearPick: ReturnType<typeof vi.fn> }).clearPick).toHaveBeenCalled();
  });

  it('names the frames around the element and steps wider or narrower, keeping what was typed', () => {
    seed();
    const p = preview() as unknown as { moveInspect: ReturnType<typeof vi.fn> };
    const { rerender } = render(<StudioPickComposer preview={p as never} />);
    const chain = screen.getByTestId('studio-pick-chain');
    expect(Array.from(chain.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['Pricing', 'PricingCard', 'h3']);
    expect(chain.querySelector('[aria-current="true"]')?.textContent).toBe('h3');
    const input = screen.getByTestId('studio-pick-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'make it bigger' } });
    fireEvent.keyDown(input, { key: 'ArrowUp', altKey: true });
    expect(p.moveInspect).toHaveBeenCalledWith('out');
    fireEvent.click(screen.getByText('pick_narrower'));
    expect(p.moveInspect).toHaveBeenCalledWith('in');
    // The page answers with the wider element: the words stay.
    rerender(<StudioPickComposer preview={{ ...(p as object), pick: { ...PICK, tag: 'div', chain: ['Pricing', 'PricingCard'] } } as never} />);
    expect((screen.getByTestId('studio-pick-input') as HTMLInputElement).value).toBe('make it bigger');
  });

  it('says so when the note has to wait, and when the queue is full', () => {
    seed({ busy: true, queuedNotes: Array.from({ length: QUEUED_NOTES_MAX }, (_, i) => `n${i}`) });
    render(<StudioPickComposer preview={preview()} />);
    const input = screen.getByTestId('studio-pick-input');
    fireEvent.change(input, { target: { value: 'bigger' } });
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByText('notes_full')).toBeTruthy();
  });

  it('Esc closes it; in pick mode it shows how to pick and Esc cancels', () => {
    seed();
    const p = preview();
    const { unmount } = render(<StudioPickComposer preview={p} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect((p as unknown as { clearPick: ReturnType<typeof vi.fn> }).clearPick).toHaveBeenCalled();
    unmount();
    const m = preview({ pick: null, picking: true });
    render(<StudioPickComposer preview={m} />);
    expect(screen.getByText('pick_mode_hint')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect((m as unknown as { startPickMode: ReturnType<typeof vi.fn> }).startPickMode).toHaveBeenCalledWith(false);
  });
});
