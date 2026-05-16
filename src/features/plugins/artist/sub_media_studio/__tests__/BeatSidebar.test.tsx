import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BeatSidebar from '../BeatSidebar';
import type { TextItem } from '../types';
import type { PlaybackEngine } from '../hooks/useTimelinePlayback';

function makeBeat(id: string, startTime: number, label = `Beat ${id}`): TextItem {
  return { id, type: 'text', label, startTime, duration: 1, text: '' };
}

/** Stub engine — captures subscribers so the test can advance the playhead. */
function makeEngine(): PlaybackEngine & { fire: (t: number) => void } {
  const subscribers = new Set<(t: number) => void>();
  return {
    subscribe: (cb: (t: number) => void) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    getTime: () => 0,
    getPlaying: () => false,
    fire: (t: number) => subscribers.forEach((cb) => cb(t)),
  } as unknown as PlaybackEngine & { fire: (t: number) => void };
}

beforeEach(() => {
  // no-op
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('BeatSidebar — render', () => {
  it('shows the title and an empty hint when there are no beats', () => {
    const engine = makeEngine();
    render(<BeatSidebar beats={[]} engine={engine} onSeek={vi.fn()} />);
    // "Beats" appears twice (title + empty message contains the word) — both
    // are expected, so use getAllByText to confirm presence rather than enforce
    // uniqueness.
    expect(screen.getAllByText(/beats/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/no beats yet/i)).toBeInTheDocument();
  });

  it('renders beats sorted by startTime ascending', () => {
    const engine = makeEngine();
    const beats = [makeBeat('c', 30, 'Outro'), makeBeat('a', 0, 'Intro'), makeBeat('b', 10, 'Hook')];
    render(<BeatSidebar beats={beats} engine={engine} onSeek={vi.fn()} />);
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const orderInList = [
      labels.findIndex((t) => t.includes('Intro')),
      labels.findIndex((t) => t.includes('Hook')),
      labels.findIndex((t) => t.includes('Outro')),
    ];
    // Each found index must be >= prior (sorted order in the rendered list).
    expect(orderInList[0]).toBeLessThan(orderInList[1]!);
    expect(orderInList[1]).toBeLessThan(orderInList[2]!);
  });
});

describe('BeatSidebar — active beat tracking', () => {
  it('highlights the latest beat whose startTime is <= current playhead', () => {
    const engine = makeEngine();
    const beats = [makeBeat('a', 0, 'Intro'), makeBeat('b', 10, 'Hook'), makeBeat('c', 30, 'Outro')];
    render(<BeatSidebar beats={beats} engine={engine} onSeek={vi.fn()} />);

    // Advance playhead to t=15. "Hook" (b, startTime=10) should be active.
    act(() => engine.fire(15));
    // The active row gets an amber border-left class; we assert via amber text.
    const hookButton = screen.getByText('Hook').closest('button')!;
    expect(hookButton.className).toMatch(/amber/);
  });

  it('does not change activeId when the latest beat at-or-before time is unchanged', () => {
    const engine = makeEngine();
    const beats = [makeBeat('a', 0, 'Intro'), makeBeat('b', 10, 'Hook')];
    render(<BeatSidebar beats={beats} engine={engine} onSeek={vi.fn()} />);
    // Two fires in the same beat range — both make "Hook" active.
    act(() => engine.fire(15));
    act(() => engine.fire(20));
    const hookButton = screen.getByText('Hook').closest('button')!;
    expect(hookButton.className).toMatch(/amber/);
  });
});

describe('BeatSidebar — interactions', () => {
  it('single-click on a beat row calls onSeek with the beat startTime', () => {
    const engine = makeEngine();
    const onSeek = vi.fn();
    const beats = [makeBeat('a', 5, 'Hook')];
    render(<BeatSidebar beats={beats} engine={engine} onSeek={onSeek} />);
    fireEvent.click(screen.getByText('Hook'));
    expect(onSeek).toHaveBeenCalledWith(5);
  });

  it('double-click on a beat row calls onSelect when provided', () => {
    const engine = makeEngine();
    const onSelect = vi.fn();
    const beats = [makeBeat('a', 5, 'Hook')];
    render(<BeatSidebar beats={beats} engine={engine} onSeek={vi.fn()} onSelect={onSelect} />);
    fireEvent.doubleClick(screen.getByText('Hook'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('collapse button hides the list (shows the thin rail)', () => {
    const engine = makeEngine();
    const beats = [makeBeat('a', 5, 'Hook')];
    render(<BeatSidebar beats={beats} engine={engine} onSeek={vi.fn()} />);
    expect(screen.getByText('Hook')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/collapse/i));
    expect(screen.queryByText('Hook')).toBeNull();
    expect(screen.getByLabelText(/expand/i)).toBeInTheDocument();
  });

  it('clicking the collapsed rail re-expands the sidebar', () => {
    const engine = makeEngine();
    const beats = [makeBeat('a', 5, 'Hook')];
    render(<BeatSidebar beats={beats} engine={engine} onSeek={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/collapse/i));
    fireEvent.click(screen.getByLabelText(/expand/i));
    expect(screen.getByText('Hook')).toBeInTheDocument();
  });
});
