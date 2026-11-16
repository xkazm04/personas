import { describe, expect, it } from 'vitest';

import { buildFixture } from '../../fixture/standupFixture';
import { buildView } from '../buildView';
import { INITIAL_UI, reduceKey, type UiState } from '../keymap';
import type { StandupView } from '../types';

const decide = buildView(buildFixture('decide'));
const armed = buildView(buildFixture('armed'));
const at = (v: StandupView, key: string) => ({ ...INITIAL_UI, sel: v.rows.findIndex((r) => r.key === key) });
const press = (ui: UiState, keys: string[], v: StandupView) => keys.reduce((u, k) => reduceKey(u, k, v).ui, ui);

describe('reduceKey: movement and layers', () => {
  it('j/k and the arrows move and clamp at both ends', () => {
    expect(press(INITIAL_UI, ['k', 'ArrowUp'], decide).sel).toBe(0);
    expect(press(INITIAL_UI, ['j', 'ArrowDown', 'j'], decide).sel).toBe(3);
    expect(press(INITIAL_UI, Array(99).fill('j'), decide).sel).toBe(decide.rows.length - 1);
  });

  it('Enter opens the decision modal, ArrowRight the dossier; Escape peels one layer at a time', () => {
    const open = reduceKey(INITIAL_UI, 'Enter', decide).ui;
    expect(open.decide).toBe(true);
    expect(reduceKey(open, 'Enter', decide).ui).toEqual(open);
    const typing = { ...open, typing: 'i-b1' };
    const once = reduceKey(typing, 'Escape', decide).ui;
    expect(once).toMatchObject({ decide: true, typing: null });
    expect(reduceKey(once, 'Escape', decide).ui.decide).toBe(false);
    const dossier = reduceKey(open, 'ArrowRight', decide).ui;
    expect(dossier).toMatchObject({ dossier: true, decide: false });
    expect(reduceKey(dossier, 'Escape', decide).ui.dossier).toBe(false);
  });

  it('j/k move the modal to the next card and keep it open', () => {
    const open = reduceKey(INITIAL_UI, 'Enter', decide).ui;
    expect(reduceKey(open, 'j', decide).ui).toMatchObject({ sel: 1, decide: true });
  });

  it('an open sheet owns the keyboard: nothing moves or decides, "?" closes only the legend', () => {
    const rules = { ...at(decide, 'i-cc'), rules: true };
    expect(reduceKey(rules, '1', decide)).toEqual({ ui: rules, intent: null });
    expect(reduceKey(rules, 'j', decide).ui.sel).toBe(rules.sel);
    const keys = { ...INITIAL_UI, keys: true };
    expect(reduceKey(keys, '?', decide).ui.keys).toBe(false);
    expect(reduceKey(INITIAL_UI, '?', decide).ui.keys).toBe(true);
  });

  it('z toggles the machine zoom and r opens the away rules', () => {
    expect(reduceKey(INITIAL_UI, 'z', decide).ui.zoom).toBe('12d');
    expect(reduceKey(INITIAL_UI, 'R', decide).ui.rules).toBe(true);
  });
});

describe('reduceKey: decisions', () => {
  it('1-3 pick a direction and jump to the next open row; a key past the proposals does nothing', () => {
    const ui = at(decide, 'i-cc');
    const { ui: next, intent } = reduceKey(ui, '2', decide);
    expect(intent).toMatchObject({ type: 'pick', index: 1, row: { key: 'i-cc' } });
    expect(decide.rows[next.sel]!.key).toBe('i-ov'); // i-pp is already decided, so the cursor skips it
    expect(reduceKey(ui, '4', decide).intent).toBeNull();
  });

  it('agent changes: 1 accepts, 2 does nothing, S skips', () => {
    const ui = at(decide, 'i-a1');
    expect(reduceKey(ui, '1', decide).intent).toMatchObject({ type: 'accept' });
    expect(reduceKey(ui, '2', decide).intent).toBeNull();
    expect(reduceKey(ui, 's', decide).intent).toMatchObject({ type: 'skip' });
    expect(reduceKey(ui, 'e', decide).ui.typing).toBeNull();
  });

  it('E types your own (also where there is no proposal), Backspace undoes', () => {
    expect(reduceKey(at(decide, 'i-b1'), 'E', decide).ui.typing).toBe('i-b1');
    expect(reduceKey(at(decide, 'i-pp'), 'Backspace', decide).intent).toMatchObject({ type: 'undo', row: { key: 'i-pp' } });
  });

  it('refused and held rows cannot be decided; T talks only where an item exists and is not refused', () => {
    expect(reduceKey(at(decide, 'i-r1'), '1', decide).intent).toBeNull();
    expect(reduceKey(at(decide, 'i-r1'), 't', decide).intent).toBeNull();
    const hold = decide.rows.findIndex((r) => r.kind === 'hold' && r.itemId);
    expect(reduceKey({ ...INITIAL_UI, sel: hold }, 's', decide).intent).toBeNull();
    expect(reduceKey({ ...INITIAL_UI, sel: hold }, 't', decide).intent).toMatchObject({ type: 'talk' });
  });

  it('G arms only a draft; N amends only an armed plan; an armed plan takes no picks', () => {
    expect(reduceKey(INITIAL_UI, 'g', decide).intent).toEqual({ type: 'arm' });
    expect(reduceKey(INITIAL_UI, 'n', decide).intent).toBeNull();
    expect(reduceKey(INITIAL_UI, 'g', armed).intent).toBeNull();
    expect(reduceKey(INITIAL_UI, 'N', armed).intent).toEqual({ type: 'amend' });
    expect(reduceKey(at(armed, 'i-gv'), '1', armed).intent).toBeNull();
  });
});
