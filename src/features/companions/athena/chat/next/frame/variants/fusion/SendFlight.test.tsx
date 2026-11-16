import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSendFlight } from './SendFlight';

vi.mock('@/hooks/utility/interaction/useMotion', () => ({ useMotion: () => ({ shouldAnimate: true }) }));

const rect = { left: 0, top: 0, width: 200, height: 20, right: 200, bottom: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

function ask(text: string): HTMLElement {
  const el = document.createElement('p');
  el.setAttribute('data-fusion-ask', '');
  el.textContent = text;
  el.getBoundingClientRect = () => rect;
  return el;
}

describe('useSendFlight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the first ask again when a second send replaces its flight', () => {
    const scope = document.createElement('div');
    document.body.appendChild(scope);
    const { result } = renderHook(() => useSendFlight({ current: scope }));
    const a = ask('first');
    scope.appendChild(a);
    act(() => { result.current.launch('first', rect); vi.advanceTimersByTime(100); });
    expect(a.style.opacity).toBe('0');
    const b = ask('second');
    scope.appendChild(b);
    act(() => { result.current.launch('second', rect); vi.advanceTimersByTime(100); });
    expect(b.style.opacity).toBe('0');
    expect(a.style.opacity).toBe('');
  });
});
