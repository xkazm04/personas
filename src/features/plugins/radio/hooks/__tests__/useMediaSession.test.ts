import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useMediaSession, type MediaSessionOptions } from '../useMediaSession';

// jsdom ships neither `navigator.mediaSession` nor the `MediaMetadata` ctor,
// so the stub below IS the OS surface under test: which actions carry a
// handler, and what the overlay would show.
interface Stub {
  handlers: Map<string, (() => void) | null>;
  metadata: unknown;
  playbackState: string;
  setActionHandler: (a: string, h: (() => void) | null) => void;
}

let stub: Stub;

function registered(): string[] {
  return [...stub.handlers.entries()].filter(([, h]) => h !== null).map(([a]) => a);
}

beforeEach(() => {
  stub = {
    handlers: new Map(),
    metadata: null,
    playbackState: 'none',
    setActionHandler(action, handler) { this.handlers.set(action, handler); },
  };
  Object.defineProperty(navigator, 'mediaSession', { value: stub, configurable: true });
  class FakeMetadata {
    title: string; artist: string; album: string;
    constructor(init: { title?: string; artist?: string; album?: string }) {
      this.title = init.title ?? '';
      this.artist = init.artist ?? '';
      this.album = init.album ?? '';
    }
  }
  (globalThis as { MediaMetadata?: unknown }).MediaMetadata = FakeMetadata;
});

function opts(over: Partial<MediaSessionOptions> = {}): MediaSessionOptions {
  return {
    active: true,
    playing: true,
    title: 'Nightcall',
    artist: 'Kavinsky',
    album: 'Drive FM',
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    ...over,
  };
}

describe('useMediaSession', () => {
  it('wires play, pause and next to the transport while playing', () => {
    const o = opts();
    renderHook(() => useMediaSession(o));

    expect(registered()).toEqual(expect.arrayContaining(['play', 'pause', 'nexttrack']));
    stub.handlers.get('play')!();
    stub.handlers.get('pause')!();
    stub.handlers.get('nexttrack')!();
    expect(o.onPlay).toHaveBeenCalledTimes(1);
    expect(o.onPause).toHaveBeenCalledTimes(1);
    expect(o.onNext).toHaveBeenCalledTimes(1);
    expect(stub.playbackState).toBe('playing');
    expect(stub.metadata).toMatchObject({ title: 'Nightcall', artist: 'Kavinsky', album: 'Drive FM' });
  });

  it('leaves skip unregistered for a station that cannot skip', () => {
    renderHook(() => useMediaSession(opts({ onNext: null, onPrevious: null })));

    expect(registered()).not.toContain('nexttrack');
    expect(registered()).not.toContain('previoustrack');
    expect(registered()).toEqual(expect.arrayContaining(['play', 'pause']));
  });

  it('clears every handler and the metadata on unmount', () => {
    const { unmount } = renderHook(() => useMediaSession(opts()));
    expect(registered().length).toBeGreaterThan(0);

    unmount();

    expect(registered()).toEqual([]);
    expect(stub.metadata).toBeNull();
    expect(stub.playbackState).toBe('none');
  });

  it('clears the session when playback stops without unmounting', () => {
    const { rerender } = renderHook((p: MediaSessionOptions) => useMediaSession(p), {
      initialProps: opts(),
    });

    rerender(opts({ active: false, playing: false }));

    expect(registered()).toEqual([]);
    expect(stub.metadata).toBeNull();
    expect(stub.playbackState).toBe('none');
  });

  it('calls the latest callback after a re-render, not the first one', () => {
    const first = opts();
    const { rerender } = renderHook((p: MediaSessionOptions) => useMediaSession(p), {
      initialProps: first,
    });
    const second = opts();
    rerender(second);

    stub.handlers.get('pause')!();

    expect(first.onPause).not.toHaveBeenCalled();
    expect(second.onPause).toHaveBeenCalledTimes(1);
  });
});
