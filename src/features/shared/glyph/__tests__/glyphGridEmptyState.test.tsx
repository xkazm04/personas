import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GlyphGrid } from '../GlyphGrid';
import { en } from '@/i18n/en';

/**
 * GlyphGrid used to hand-roll its empty state as a rounded card with an
 * italic centred span, so the four surfaces that share this grid (adoption,
 * edit, view, template preview) all showed an empty state that looked like
 * nothing else in the app.
 */
describe('GlyphGrid empty state', () => {
  it('renders the shared empty-state primitive, not a bespoke card', () => {
    const { container } = render(<GlyphGrid rows={[]} emptyLabel="Nothing here" />);

    // ScenarioEmptyState's structural signature: a heading carrying the
    // title, and an icon badge above it.
    const heading = container.querySelector('h3');
    expect(heading?.textContent).toBe('Nothing here');
    expect(container.querySelector('svg')).not.toBeNull();

    // The hand-rolled card is gone.
    expect(container.querySelector('.italic')).toBeNull();
    expect(container.querySelector('.shadow-elevation-2')).toBeNull();
  });

  it('falls back to the seeding copy when no label is supplied', () => {
    const { container } = render(<GlyphGrid rows={[]} />);
    expect(container.querySelector('h3')?.textContent).toBe(en.templates.chronology.empty_seeding);
  });
});
