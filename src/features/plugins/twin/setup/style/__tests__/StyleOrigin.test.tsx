import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StyleOrigin } from '../StyleOrigin';

const dims = { formality: 4, warmth: 3, humor: 1, energy: 3, length: 3, directness: 2, expressiveness: 1, detail: 3 };

describe('StyleOrigin', () => {
  it('names a learned style by its origin, never as an empty "Rolled:"', () => {
    render(<StyleOrigin styleJson={JSON.stringify({ source: 'learned', presetId: null, name: '', summary: 'from a sample', avoid: '', dims })} />);
    const origin = screen.getByTestId('style-origin');
    expect(origin.textContent).toContain('Learned from your writing');
    expect(origin.textContent).not.toMatch(/Rolled/);
  });

  it('renders nothing for a hand-written row', () => {
    const { container } = render(<StyleOrigin styleJson={null} />);
    expect(container.firstChild).toBeNull();
  });
});
