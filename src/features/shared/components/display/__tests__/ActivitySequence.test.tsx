import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivitySequence } from '../ActivitySequence';
import type { RecipeActivity } from '@/lib/personas/recipeV3';

const FOUR: RecipeActivity[] = [
  { id: 'collect', label: 'Pull engagement for the window', kind: 'observe' },
  { id: 'compare', label: 'Compare against rolling baselines', kind: 'decide' },
  { id: 'flag', label: 'Flag spikes and underperformers', kind: 'act' },
  { id: 'update', label: 'Update the baselines', kind: 'deliver' },
];

describe('ActivitySequence', () => {
  it('renders one chip per activity, in the order given', () => {
    render(<ActivitySequence activities={FOUR} />);
    const seq = screen.getByTestId('activity-seq');
    const chips = Array.from(seq.querySelectorAll('[data-testid^="activity-seq-"]'));
    expect(chips.map((c) => c.getAttribute('data-testid'))).toEqual([
      'activity-seq-collect',
      'activity-seq-compare',
      'activity-seq-flag',
      'activity-seq-update',
    ]);
  });

  it('carries each activity kind on the chip', () => {
    render(<ActivitySequence activities={FOUR} />);
    expect(screen.getByTestId('activity-seq-collect').getAttribute('data-kind')).toBe('observe');
    expect(screen.getByTestId('activity-seq-update').getAttribute('data-kind')).toBe('deliver');
  });

  it('tints each kind distinctly through semantic status tokens', () => {
    render(<ActivitySequence activities={FOUR} />);
    const tint = (id: string) => screen.getByTestId(`activity-seq-${id}`).className;
    expect(tint('collect')).toContain('status-neutral');
    expect(tint('compare')).toContain('status-info');
    expect(tint('flag')).toContain('status-warning');
    expect(tint('update')).toContain('status-success');
    // Four distinct hues, so a reader can tell the kinds apart at a glance.
    const hues = FOUR.map((a) => tint(a.id).match(/status-\w+/)?.[0]);
    expect(new Set(hues).size).toBe(4);
  });

  it('renders nothing for an empty sequence rather than an empty rail', () => {
    // A pre-v3 charter has no activities at all; an empty diagram would claim a
    // shape nobody wrote.
    const { container } = render(<ActivitySequence activities={[]} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('activity-seq')).toBeNull();
  });

  it('announces the kind only when the caller supplies labels', () => {
    const { rerender } = render(<ActivitySequence activities={[FOUR[0]]} />);
    expect(screen.queryByText('Observe:', { exact: false })).toBeNull();
    rerender(
      <ActivitySequence
        activities={[FOUR[0]]}
        kindLabels={{ observe: 'Observe', decide: 'Decide', act: 'Act', deliver: 'Deliver' }}
      />,
    );
    expect(screen.getByText('Observe:', { exact: false })).toBeTruthy();
  });

  it('draws a separator between chips and never before the first', () => {
    const { container } = render(<ActivitySequence activities={FOUR} />);
    // One chevron per gap: four chips, three gaps.
    expect(container.querySelectorAll('svg.lucide-chevron-right').length).toBe(3);
  });
});
