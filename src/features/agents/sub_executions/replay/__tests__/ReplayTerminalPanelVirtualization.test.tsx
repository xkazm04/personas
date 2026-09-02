import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReplayTerminalPanel } from '../ReplayTerminalPanel';

function lines(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    text: `line ${i} plain output`,
    timestamp_ms: i,
  }));
}

describe('ReplayTerminalPanel virtualization', () => {
  it('renders every line directly for a short log (no virtualizer overhead)', () => {
    // Below the threshold the plain map is cheaper, and this arm is also the
    // measurement of the OLD behaviour: one DOM node per line, always.
    render(<ReplayTerminalPanel visibleLines={lines(40)} totalLines={40} />);
    expect(screen.getAllByTestId('replay-terminal-line')).toHaveLength(40);
  });

  it('creates a bounded number of line elements for a long log', () => {
    // `get_execution_log` is unpaginated against a 10 MB stdout cap, so the
    // line count is unbounded by construction. Scrubbing to End must not
    // materialise the whole log.
    render(<ReplayTerminalPanel visibleLines={lines(5000)} totalLines={5000} />);
    const rendered = screen.getAllByTestId('replay-terminal-line');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(200);
  });

  it('keeps the scrollbar describing the whole log, not just the window', () => {
    const { container } = render(
      <ReplayTerminalPanel visibleLines={lines(5000)} totalLines={5000} />,
    );
    const spacer = container.querySelector('.relative.w-full') as HTMLElement | null;
    expect(spacer).not.toBeNull();
    // The spacer is sized from the virtualizer's total, not from the window.
    expect(spacer!.style.height).not.toBe('');
  });
});
