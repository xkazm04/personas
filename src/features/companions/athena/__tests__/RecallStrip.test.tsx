import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecallStrip } from '../RecallStrip';
import type {
  CompanionRecallLane,
  CompanionRecallPreview,
  CompanionRecallPreviewEntry,
} from '@/api/companion';

function preview(over: Partial<CompanionRecallPreview> = {}): CompanionRecallPreview {
  return {
    episodeCount: 0,
    doctrine: [],
    facts: [],
    procedurals: [],
    goals: [],
    backlog: [],
    synthesized: false,
    droppedFar: 0,
    relevanceFloor: null,
    ...over,
  };
}

/**
 * A chip entry. Defaults to the keyword lane with no score, which is the
 * shape most entries have on the build that ships (no `ml` feature, so no
 * vector lane and nothing carries a distance).
 */
function chip(
  id: string,
  title: string,
  lane: CompanionRecallLane = 'keyword',
  relevance: number | null = null,
): CompanionRecallPreviewEntry {
  return { id, title, lane, relevance };
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
          facts: [chip('fact_a', 'user_prefers_short_replies')],
          doctrine: [chip('d', 'persona-design · best practices')],
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
          facts: [chip('fact_a', 'fact-key-alpha')],
          procedurals: [chip('p', 'when X then Y')],
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
          facts: [chip('fact_a', 'fact-key-alpha')],
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
          facts: [chip('fact_a', 'fact-key-alpha')],
          procedurals: [chip('p1', 'rule-x')],
          doctrine: [chip('d1', 'persona-design')],
          goals: [chip('g1', 'goal-y')],
          backlog: [chip('b1', 'backlog-z')],
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
          facts: [{ lane: 'keyword' as const, relevance: null, id: '', title: 'no-id-fact' }],
        })}
        onOpenInBrain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByTestId('companion-recall-chip')).toBeNull();
    expect(screen.getByText('no-id-fact').tagName).toBe('SPAN');
  });
});

describe('RecallStrip provenance', () => {
  it('tags each chip with the lane that produced it', () => {
    render(
      <RecallStrip
        preview={preview({
          episodeCount: 1,
          facts: [chip('f1', 'matched-fact', 'vector', 0.8)],
          goals: [chip('g1', 'always-goal', 'always')],
        })}
        onOpenInBrain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const chips = screen.getAllByTestId('companion-recall-chip');
    const lanes = chips.map((c) => c.getAttribute('data-lane'));
    expect(lanes).toContain('vector');
    expect(lanes).toContain('always');
  });

  it('draws a relevance bar for a vector hit and none for an always-on entry', () => {
    const { container } = render(
      <RecallStrip
        preview={preview({
          episodeCount: 1,
          facts: [chip('f1', 'matched-fact', 'vector', 0.5)],
          goals: [chip('g1', 'always-goal', 'always')],
        })}
        onOpenInBrain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // Exactly one bar: the vector hit. An always-on entry has no distance, so
    // inventing a bar for it would be the failure this whole feature exists to
    // avoid.
    const bars = container.querySelectorAll('[aria-hidden="true"] > span');
    expect(bars).toHaveLength(1);
    expect((bars[0] as HTMLElement).style.width).toBe('50%');
  });

  it('reports what the relevance floor rejected', () => {
    render(
      <RecallStrip
        preview={preview({
          episodeCount: 1,
          facts: [chip('f1', 'matched-fact', 'vector', 0.9)],
          droppedFar: 7,
          relevanceFloor: 1.3,
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const note = screen.getByTestId('companion-recall-floor-note');
    expect(note.textContent).toContain('7');
    expect(note.textContent).toContain('1.30');
  });

  it('hides the floor note on a build with no vector lane', () => {
    render(
      <RecallStrip
        preview={preview({
          episodeCount: 1,
          facts: [chip('f1', 'keyword-fact')],
          droppedFar: 0,
          relevanceFloor: null,
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByTestId('companion-recall-floor-note')).toBeNull();
  });

  it('survives a payload built before these fields existed', () => {
    // The event is a plain JSON payload from Rust; an older build (or a
    // replayed event) carries neither field. A diagnostic footer must never
    // take the chat surface down.
    const legacy = {
      episodeCount: 1,
      doctrine: [],
      facts: [{ id: 'f1', title: 'legacy-fact' }],
      procedurals: [],
      goals: [],
      backlog: [],
      synthesized: false,
    } as unknown as CompanionRecallPreview;
    render(<RecallStrip preview={legacy} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('legacy-fact')).toBeInTheDocument();
    expect(screen.queryByTestId('companion-recall-floor-note')).toBeNull();
  });
});
