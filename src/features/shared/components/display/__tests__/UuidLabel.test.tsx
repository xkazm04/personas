import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UuidLabel } from '../UuidLabel';

const ID = '3f2a9c1e-7b44-4d2a-9e1f-0c5b8a7d6e21';

describe('UuidLabel', () => {
  it('gives the icon-only copy button an accessible name', () => {
    render(<UuidLabel value={ID} />);
    const btn = screen.getByRole('button');
    expect((btn.getAttribute('aria-label') ?? '').trim().length).toBeGreaterThan(0);
  });

  it('reveals the copy button on keyboard focus, not only on pointer hover', () => {
    render(<UuidLabel value={ID} />);
    // opacity-0 until group-hover hid the control from a keyboard user who had
    // tabbed onto it: a focused, invisible button.
    expect(screen.getByRole('button').className).toMatch(/focus-visible:opacity-100/);
  });
});
