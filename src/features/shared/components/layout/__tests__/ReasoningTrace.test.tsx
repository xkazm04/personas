import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReasoningTrace from '../ReasoningTrace';
import { filterTraceEntries, lastErrorIndex, traceToMarkdown } from '../reasoningTraceModel';
import type { ReasoningEntry } from '@/hooks/execution/useReasoningTrace';

const BASE = 1_700_000_000_000;

const fixture: ReasoningEntry[] = [
  { type: 'text', content: 'Thinking about the plan', ts: BASE },
  { type: 'tool_call', toolName: 'Read', inputPreview: '{"path":"a.ts"}', ts: BASE + 2000 },
  { type: 'error', message: 'Tool crashed hard', ts: BASE + 4000 },
  { type: 'complete', durationMs: 5000, cost: 0.12, tokens: 900, ts: BASE + 5000 },
];

describe('reasoningTraceModel', () => {
  it('filters to the tool lane and to errors', () => {
    expect(filterTraceEntries(fixture, 'all')).toHaveLength(4);
    expect(filterTraceEntries(fixture, 'tools').map((e) => e.type)).toEqual(['tool_call']);
    expect(filterTraceEntries(fixture, 'errors').map((e) => e.type)).toEqual(['error']);
  });

  it('serialises the visible slice as markdown with full payloads', () => {
    const md = traceToMarkdown(fixture, BASE);
    expect(md).toContain('- [2s] tool_call Read: {"path":"a.ts"}');
    expect(md).toContain('- [4s] error: Tool crashed hard');
    expect(traceToMarkdown([], BASE)).toBe('');
  });

  it('reports the last error index, or -1', () => {
    expect(lastErrorIndex(fixture)).toBe(2);
    expect(lastErrorIndex(fixture.filter((e) => e.type !== 'error'))).toBe(-1);
  });
});

describe('ReasoningTrace', () => {
  it('filters the rendered rows to errors via the chip', () => {
    render(<ReasoningTrace entries={fixture} isLive={false} startTime={BASE} />);
    expect(screen.getByText('Tool crashed hard')).toBeTruthy();
    expect(screen.getByText(/Read/)).toBeTruthy();

    fireEvent.click(screen.getByText('Errors'));
    expect(screen.getByText('Tool crashed hard')).toBeTruthy();
    expect(screen.queryByText(/Read/)).toBeNull();
  });

  it('scrolls the latest error row into view when Jump is pressed', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      writable: true,
      configurable: true,
    });
    render(<ReasoningTrace entries={fixture} isLive={false} startTime={BASE} />);
    fireEvent.click(screen.getByText('Jump to error'));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('renders only the waiting copy (no toolbar) for an empty trace', () => {
    render(<ReasoningTrace entries={[]} isLive />);
    expect(screen.queryByText('Errors')).toBeNull();
    expect(screen.queryByText('Jump to error')).toBeNull();
  });

  it('hides Jump when the trace holds no error', () => {
    render(
      <ReasoningTrace entries={fixture.filter((e) => e.type !== 'error')} isLive={false} startTime={BASE} />,
    );
    expect(screen.queryByText('Jump to error')).toBeNull();
  });
});

describe('ReasoningTrace row identity', () => {
  const LONG = 'x'.repeat(200);
  const longText = (n: number): ReasoningEntry => ({ type: 'text', content: `${n} ${LONG}`, ts: BASE + n * 1000 });

  it('does not hand an expanded row to the entry that takes its slot under a filter', () => {
    const entries: ReasoningEntry[] = [
      longText(0),
      { type: 'tool_call', toolName: 'Read', inputPreview: `in ${LONG}`, ts: BASE + 2000 },
    ];
    render(<ReasoningTrace entries={entries} isLive={false} startTime={BASE} />);
    const [textToggle] = screen.getAllByRole('button', { name: 'Show more' });
    fireEvent.click(textToggle!);
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1);

    fireEvent.click(screen.getByText('Tools'));
    // The tool row now sits at index 0, where the expanded text row was.
    expect(screen.queryAllByRole('button', { expanded: true })).toHaveLength(0);
  });

  it('keeps an expanded row with its entry when the window slides', () => {
    const a = longText(0);
    const b = longText(1);
    const c = longText(2);
    const { rerender } = render(<ReasoningTrace entries={[a, b, c]} isLive={false} startTime={BASE} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Show more' })[1]!);

    // The hook's 500-entry cap drops the oldest entry: every survivor moves up one slot.
    rerender(<ReasoningTrace entries={[b, c, longText(3)]} isLive={false} startTime={BASE} />);
    const expanded = screen.getAllByRole('button', { expanded: true });
    expect(expanded).toHaveLength(1);
    expect(expanded[0]!.textContent).toContain('1 xxx');
  });
});
