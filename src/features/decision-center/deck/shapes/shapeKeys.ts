/**
 * The key map's entries for the lane shapes, in the card's own verbs (the
 * grammar is `useShapeController`'s). `null` for a shape that keeps its modal
 * type's map. React-free.
 */
import type { Entry } from '../KeyLegend';
import type { MonitorCopy } from '../deckMeta';
import type { CardShape } from './cardShape';

export function shapeEntries(m: MonitorCopy, shape: CardShape, v: { accept: string; reject: string }): Entry[] | null {
  const tail: Entry[] = [
    [['S'], m.dc_deck_key_later],
    [['I'], m.dc_deck_key_fold],
    [['←', '→'], m.dc_deck_key_walk],
    [['Esc'], m.dc_deck_key_back],
    [['?'], m.dc_deck_key_help],
  ];
  switch (shape) {
    case 'sign':
      return [[['A', '↵'], m.ml_keys_sign], [['X'], m.ml_keys_drop], [['E'], m.ml_keys_edit], ...tail];
    case 'breach':
      return [[['1', '↵'], m.ml_keys_amend], [['2'], m.ml_keys_deny], [['3'], m.ml_keys_suspend], [['4-9'], m.dc_deck_key_branch], ...tail];
    case 'valve':
      return [[['A', '↵'], m.ml_keys_valve], [['R'], v.reject.toLowerCase()], ...tail];
    case 'claim':
      return [
        [['A'], v.accept.toLowerCase()], [['R'], m.ml_keys_send_back], [['1-3'], m.ml_keys_pick],
        [['V'], m.ml_keys_revert], [['N'], m.ml_keys_narrow], [['4-9'], m.dc_deck_key_branch], ...tail,
      ];
    case 'default':
      return null;
  }
}
