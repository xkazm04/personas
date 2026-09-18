import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { matchIslands } from '../lib/islandSearch';
import { IslandJumpPalette } from '../lib/IslandJumpPalette';

const ISLANDS = [
  { slug: 'atlas', name: 'Atlas' },
  { slug: 'personas', name: 'Personas Desktop' },
  { slug: 'web', name: 'Personas Web' },
  { slug: 'ship', name: 'Ship' },
  { slug: 'shipping', name: 'Shipping pipeline rewrite' },
];

describe('matchIslands', () => {
  it('finds an island by a fragment of its name', () => {
    expect(matchIslands(ISLANDS, 'desktop').map((i) => i.slug)).toEqual(['personas']);
  });

  it('ranks a prefix match above a mid-word one', () => {
    // "ship" starts Ship / Shipping and sits mid-word nowhere else.
    expect(matchIslands(ISLANDS, 'ship').map((i) => i.slug)).toEqual(['ship', 'shipping']);
  });

  it('is case- and accent-insensitive', () => {
    const accented = [{ slug: 'r', name: 'Révès' }];
    expect(matchIslands(accented, 'reves')).toHaveLength(1);
    expect(matchIslands(ISLANDS, 'PERSONAS')).toHaveLength(2);
  });

  it('returns nothing for a name no island has', () => {
    expect(matchIslands(ISLANDS, 'nowhere')).toEqual([]);
  });

  it('shows where you can go when the query is still empty', () => {
    expect(matchIslands(ISLANDS, '').map((i) => i.name)).toEqual([
      'Atlas', 'Personas Desktop', 'Personas Web', 'Ship', 'Shipping pipeline rewrite',
    ]);
  });

  it('caps the list so the palette cannot grow unbounded', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ slug: `s${i}`, name: `Island ${i}` }));
    expect(matchIslands(many, 'island')).toHaveLength(8);
  });
});

function open(overrides: Partial<Parameters<typeof IslandJumpPalette>[0]> = {}) {
  const props = {
    islands: ISLANDS,
    onJump: vi.fn(),
    onMiss: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<IslandJumpPalette {...props} />);
  return props;
}

describe('IslandJumpPalette', () => {
  it('hit: typing a name and pressing Enter jumps to that island', () => {
    const { onJump, onClose } = open();
    const input = screen.getByTestId('mm-jump-input');

    fireEvent.change(input, { target: { value: 'desktop' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The shell binds onJump to `focusSlug`, the same door the arrow keys use,
    // so focus + announce + pan all happen exactly as a cursor move does.
    expect(onJump).toHaveBeenCalledWith('personas');
    expect(onClose).toHaveBeenCalled();
  });

  it('miss: an unknown name announces instead of dying silently', () => {
    const { onJump, onMiss, onClose } = open();
    const input = screen.getByTestId('mm-jump-input');

    fireEvent.change(input, { target: { value: 'nowhere' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onMiss).toHaveBeenCalledWith('nowhere');
    expect(onJump).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('mm-jump-empty')).toBeTruthy();
  });

  it('arrow keys walk the results and Enter takes the highlighted one', () => {
    const { onJump } = open();
    const input = screen.getByTestId('mm-jump-input');

    // Both are prefix matches, so the shorter name leads: Personas Web first.
    fireEvent.change(input, { target: { value: 'personas' } });
    expect(screen.getByTestId('mm-jump-option-web').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onJump).toHaveBeenCalledWith('personas');
  });

  it('clicking a result jumps to it', () => {
    const { onJump, onClose } = open();
    fireEvent.mouseDown(screen.getByTestId('mm-jump-option-atlas'));
    expect(onJump).toHaveBeenCalledWith('atlas');
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes without jumping', () => {
    const { onJump, onClose } = open();
    fireEvent.keyDown(screen.getByTestId('mm-jump-input'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(onJump).not.toHaveBeenCalled();
  });

  it('a narrowed query resets the cursor so Enter cannot pick a stale row', () => {
    const { onJump } = open();
    const input = screen.getByTestId('mm-jump-input');

    // Cursor lands on row 1 of a two-row list, then the query narrows to one
    // row: without the reset, Enter would read past the end of the results.
    fireEvent.change(input, { target: { value: 'personas' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.change(input, { target: { value: 'desktop' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onJump).toHaveBeenCalledWith('personas');
  });
});
