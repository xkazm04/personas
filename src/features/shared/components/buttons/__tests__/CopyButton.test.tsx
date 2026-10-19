import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CopyButton } from '../CopyButton';

describe('CopyButton naming', () => {
  it('icon-only: one tooltip (the shared one), named by aria-label', () => {
    render(<CopyButton text="abc" />);
    const btn = screen.getByRole('button', { name: 'Copy' });
    expect(btn.hasAttribute('title')).toBe(false);
  });

  it('icon-only with a custom tooltip: that text is the name', () => {
    render(<CopyButton text="abc" tooltip="Copy run id" />);
    const btn = screen.getByRole('button', { name: 'Copy run id' });
    expect(btn.hasAttribute('title')).toBe(false);
  });

  it('labelled: the visible label is the name', () => {
    render(<CopyButton text="abc" label="Copy link" tooltip="Copies the share link" />);
    const btn = screen.getByRole('button', { name: 'Copy link' });
    expect(btn.hasAttribute('title')).toBe(false);
  });
});
