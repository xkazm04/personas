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
});
