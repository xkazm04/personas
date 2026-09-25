import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// A decision that points at an element asks the preview agent to locate it,
// retrying while the agent may still be loading. Once the agent has answered,
// the pings stop: eight posts a question were eight re-renders and eight orb
// flights to the same place.

vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('@/api/webbuild', () => ({ webbuildListRoutes: () => Promise.resolve(['/']) }));

const { useStudioStore } = await import('../studioStore');
const { useStudioPreview } = await import('../useStudioPreview');

type RT = ReturnType<typeof useStudioStore.getState>['runtimes'][string];

let frame: HTMLIFrameElement;
beforeEach(() => {
  vi.useFakeTimers();
  frame = document.createElement('iframe');
  frame.dataset.tab = 'p1';
  document.body.appendChild(frame);
  useStudioStore.setState({
    runtimes: {
      p1: {
        id: 'p1', name: 'Hearth', phase: 'live', status: { healthy: true, url: 'http://localhost:5000' },
        question: 'Keep this banner?', decisionSelector: '#hero', decisionArea: null, phases: [], messages: [],
      } as unknown as RT,
    },
    tabOrder: ['p1'],
    activeId: 'p1',
  });
});
afterEach(() => {
  cleanup();
  frame.remove();
  vi.useRealTimers();
  useStudioStore.setState({ runtimes: {}, tabOrder: [], activeId: null });
});

describe('locate ping', () => {
  it('stops pinging once the agent has found the element', () => {
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
    const { result } = renderHook(() => useStudioPreview());
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(post).toHaveBeenCalledTimes(1);
    const rect = { x: 10, y: 20, width: 100, height: 40 };
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { source: 'athena-agent', type: 'located', found: true, rect }, source: frame.contentWindow }),
      );
    });
    expect(result.current.pointerRect).toEqual(rect);
    const first = result.current.pointerRect;
    act(() => {
      vi.advanceTimersByTime(700 * 8);
    });
    expect(post).toHaveBeenCalledTimes(1);
    // The same rect reported again keeps the same object: no re-render, no new flight.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { source: 'athena-agent', type: 'located', found: true, rect: { ...rect } }, source: frame.contentWindow }),
      );
    });
    expect(result.current.pointerRect).toBe(first);
  });
});

describe('right-click targeting', () => {
  const pickedMsg = (source: Window | null) =>
    new MessageEvent('message', {
      data: { source: 'athena-agent', type: 'picked', selector: '.pricing > div:nth-of-type(2) > h3', label: 'Pro $19', tag: 'h3', rect: { x: 40, y: 300, width: 200, height: 30 }, path: '/pricing' },
      source,
    });

  it('keeps the element the active preview reports, and nothing another frame claims', () => {
    const { result } = renderHook(() => useStudioPreview());
    const stranger = document.createElement('iframe');
    document.body.appendChild(stranger);
    act(() => {
      window.dispatchEvent(pickedMsg(stranger.contentWindow));
    });
    expect(result.current.pick).toBeNull();
    stranger.remove();
    act(() => {
      window.dispatchEvent(pickedMsg(frame.contentWindow));
    });
    expect(result.current.pick).toMatchObject({ projectId: 'p1', label: 'Pro $19', path: '/pricing' });
    act(() => result.current.clearPick());
    expect(result.current.pick).toBeNull();
  });

  it('the Tweak tool asks the active preview to pick the next click', () => {
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
    const { result } = renderHook(() => useStudioPreview());
    act(() => result.current.startPickMode());
    expect(result.current.picking).toBe(true);
    expect(post).toHaveBeenCalledWith({ source: 'athena', type: 'inspect', on: true }, 'http://localhost:5000');
    act(() => result.current.moveInspect('out'));
    expect(post).toHaveBeenCalledWith({ source: 'athena', type: 'inspect-move', dir: 'out' }, 'http://localhost:5000');
  });

  it('leaving inspect mode inside the page (Esc there) closes the composer', () => {
    const { result } = renderHook(() => useStudioPreview());
    act(() => {
      window.dispatchEvent(pickedMsg(frame.contentWindow));
    });
    expect(result.current.pick).not.toBeNull();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'athena-agent', type: 'inspect', on: false }, source: frame.contentWindow }));
    });
    expect(result.current.pick).toBeNull();
    expect(result.current.picking).toBe(false);
  });
});

