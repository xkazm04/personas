import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecallStrip } from '../RecallStrip';
import type { CompanionRecallPreview } from '@/api/companion';

function preview(over: Partial<CompanionRecallPreview> = {}): CompanionRecallPreview {
  return {
    episodeCount: 0,
    doctrine: [],
    facts: [],
    procedurals: [],
    goals: [],
    backlog: [],
    synthesized: false,
    ...over,
  };
}

describe('RecallStrip', () => {
  it('renders nothing when every count is zero', () => {
    const { container } = render(<RecallStrip preview={preview()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the strip when episodes were replayed', () => {
    render(<RecallStrip preview={preview({ episodeCount: 5 })} />);
    expect(
      screen.getByTestId('companion-recall-strip'),
    ).toBeInTheDocument();
  });

  it('combines episode count + memories in the summary line', () => {
    render(
      <RecallStrip
        preview={preview({
          episodeCount: 5,
          facts: [{ id: 'fact_a', title: 'user_prefers_short_replies' }],
          doctrine: [{ id: 'd', title: 'persona-design · best practices' }],
        })}
      />,
    );
    // {episodes}=5 {memories}=2
    expect(screen.getByText(/5/)).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it('expands chip groups on click', () => {
    render(
      <RecallStrip
        preview={preview({
          episodeCount: 1,
          facts: [{ id: 'fact_a', title: 'fact-key-alpha' }],
          procedurals: [{ id: 'p', title: 'when X then Y' }],
        })}
      />,
    );
    // collapsed: no chip text visible
    expect(screen.queryByText('fact-key-alpha')).toBeNull();
    // click the header button
    fireEvent.click(screen.getByRole('button'));
    // expanded: chips visible
    expect(screen.getByText('fact-key-alpha')).toBeInTheDocument();
    expect(screen.getByText('when X then Y')).toBeInTheDocument();
  });

  it('renders the synthesized badge when synthesis was used', () => {
    render(
      <RecallStrip preview={preview({ episodeCount: 1, synthesized: true })} />,
    );
    // badge text comes from i18n key recall_synthesized_badge
    const badge = screen.queryByText(/synthesized/i);
    expect(badge).not.toBeNull();
  });

  it('omits the synthesized badge when synthesis is false', () => {
    render(<RecallStrip preview={preview({ episodeCount: 1 })} />);
    expect(screen.queryByText(/synthesized/i)).toBeNull();
  });

  it('renders chips as read-only spans when onOpenInBrain is not provided', () => {
    render(
      <RecallStrip
        preview={preview({
          episodeCount: 1,
          facts: [{ id: 'fact_a', title: 'fact-key-alpha' }],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button')); // expand header
    expect(screen.queryByTestId('companion-recall-chip')).toBeNull();
    expect(screen.getByText('fact-key-alpha').tagName).toBe('SPAN');
  });

  it('renders chips as buttons + calls onOpenInBrain with kind+id on click', () => {
    const calls: { kind: string; id: string }[] = [];
    render(
      <RecallStrip
        preview={preview({
          episodeCount: 1,
          facts: [{ id: 'fact_a', title: 'fact-key-alpha' }],
          procedurals: [{ id: 'p1', title: 'rule-x' }],
          doctrine: [{ id: 'd1', title: 'persona-design' }],
          goals: [{ id: 'g1', title: 'goal-y' }],
          backlog: [{ id: 'b1', title: 'backlog-z' }],
        })}
        onOpenInBrain={(kind, id) => calls.push({ kind, id })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Athena/i })); // expand header
    const chips = screen.getAllByTestId('companion-recall-chip');
    expect(chips).toHaveLength(5);
    // Click each chip and verify kind+id flow through.
    chips.forEach((chip) => fireEvent.click(chip));
    expect(calls).toEqual([
      { kind: 'doctrine', id: 'd1' },
      { kind: 'fact', id: 'fact_a' },
      { kind: 'procedural', id: 'p1' },
      { kind: 'goal', id: 'g1' },
      { kind: 'backlog', id: 'b1' },
    ]);
  });

  it('falls back to a span when an entry has no id (defensive)', () => {
    render(
      <RecallStrip
        preview={preview({
          episodeCount: 1,
          facts: [{ id: '', title: 'no-id-fact' }],
        })}
        onOpenInBrain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByTestId('companion-recall-chip')).toBeNull();
    expect(screen.getByText('no-id-fact').tagName).toBe('SPAN');
  });
});
