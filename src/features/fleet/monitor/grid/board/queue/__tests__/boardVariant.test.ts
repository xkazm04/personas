// The two per-viewer preferences on the board, and their fallbacks.
//
// The retired layouts (`ranked`, `horizon`) are the reason the board variant
// test exists: a viewer who chose one before the descoping has that string in
// localStorage, and the board has to open on `classic` rather than on a
// switch whose value is not one of its tabs.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BOARD_VARIANTS, BOARD_VARIANT_KEY, isBoardVariant, readBoardVariant, writeBoardVariant,
} from '../boardVariant';
import {
  NODE_VARIANTS, NODE_VARIANT_KEY, isNodeVariant, readNodeVariant, writeNodeVariant,
} from '../../node/nodeVariant';

beforeEach(() => { localStorage.clear(); });

describe('board variant', () => {
  it('is classic | runway | lanes — the two retired layouts are gone', () => {
    expect([...BOARD_VARIANTS]).toEqual(['classic', 'runway', 'lanes']);
    expect(isBoardVariant('ranked')).toBe(false);
    expect(isBoardVariant('horizon')).toBe(false);
  });

  it('falls back to classic for a stored ranked or horizon', () => {
    localStorage.setItem(BOARD_VARIANT_KEY, 'ranked');
    expect(readBoardVariant()).toBe('classic');
    localStorage.setItem(BOARD_VARIANT_KEY, 'horizon');
    expect(readBoardVariant()).toBe('classic');
    localStorage.setItem(BOARD_VARIANT_KEY, 'nonsense');
    expect(readBoardVariant()).toBe('classic');
  });

  it('round-trips a live value', () => {
    writeBoardVariant('lanes');
    expect(readBoardVariant()).toBe('lanes');
    expect(readBoardVariant()).toBe(localStorage.getItem(BOARD_VARIANT_KEY));
  });
});

describe('node variant', () => {
  it('is ledger | badge | meter, defaulting to ledger', () => {
    expect([...NODE_VARIANTS]).toEqual(['ledger', 'badge', 'meter']);
    expect(readNodeVariant()).toBe('ledger');
    expect(isNodeVariant('classic')).toBe(false);
  });

  it('falls back to ledger for an unknown stored value and round-trips a live one', () => {
    localStorage.setItem(NODE_VARIANT_KEY, 'ranked');
    expect(readNodeVariant()).toBe('ledger');
    writeNodeVariant('meter');
    expect(readNodeVariant()).toBe('meter');
  });
});
