import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import HeroHeader from '../HeroHeader';

/**
 * Welcome-hero smoke: HeroHeader is the greeting surface of the Home →
 * Welcome layout. It reads theme + tier stores but is otherwise presentational,
 * so it renders with real store defaults (no mocks needed).
 */
describe('HeroHeader (welcome greeting smoke)', () => {
  it('renders the greeting and display name together', () => {
    render(<HeroHeader greeting="Good morning" displayName="Commander" />);
    expect(
      screen.getByRole('heading', { name: /Good morning, Commander/ }),
    ).toBeInTheDocument();
  });

  it('renders the Personas logo', () => {
    render(<HeroHeader greeting="Good evening" displayName="Commander" />);
    expect(screen.getByAltText('Personas logo')).toBeInTheDocument();
  });
});
