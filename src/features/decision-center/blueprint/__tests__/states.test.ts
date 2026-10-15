/**
 * The state table and the keymap, as tables (WP4a):
 *  - every status of `wire.ts ProposalStatus` is in STATUS, and nothing else is;
 *  - every move's from / to is a real status, and the moves a status offers are exactly the moves whose `from` has it;
 *  - the Build queue holds exactly proposed and approved;
 *  - no two key bindings collide, and every action has its sentence in the English catalog.
 */
import { describe, expect, it } from 'vitest';
import type { ProposalStatus } from '@/lib/lensScan/wire';
import en from '@/i18n/locales/en.json';
import { KEYMAP, actOf, lensIndexOfKey } from '../model/keymap';
import { MOVES, STATUS, STATUSES, actable, movesFrom, type MoveName } from '../model/states';

// A Record over the wire's union: a status added to ProposalStatus fails to compile here until it is listed.
const WIRE: Record<ProposalStatus, true> = {
  proposed: true, approved: true, declined: true, executing: true, done: true, failed: true, accepted: true, rework: true, descoped: true, released: true,
};

describe('state table', () => {
  it('covers every ProposalStatus of the wire, and no other', () => {
    expect([...STATUSES].sort()).toEqual(Object.keys(WIRE).sort());
  });

  it('every move goes from real statuses to a real status (or back to where the item was)', () => {
    for (const [name, m] of Object.entries(MOVES)) {
      expect(m.from.length, name).toBeGreaterThan(0);
      for (const s of m.from) expect(STATUS[s], `${name} from ${s}`).toBeDefined();
      if (m.to === 'triaged_from') expect(name).toBe('reopen');
      else expect(STATUS[m.to], `${name} to ${m.to}`).toBeDefined();
      expect(new Set(m.from).size).toBe(m.from.length);
    }
  });

  it('a move never leaves its own target status (no self-loop except through a note)', () => {
    for (const [name, m] of Object.entries(MOVES)) if (m.to !== 'triaged_from') expect(m.from.includes(m.to), name).toBe(false);
  });

  it('the moves a status offers are exactly the moves whose from has it', () => {
    for (const s of STATUSES) {
      const offered = movesFrom(s);
      const expected = (Object.keys(MOVES) as MoveName[]).filter((n) => MOVES[n].from.includes(s));
      expect(offered).toEqual(expected);
      for (const n of offered) expect(actable(n, s)).toBe(true);
    }
  });

  it('proposed offers approve and decline; approved offers build; a released item offers nothing', () => {
    expect(movesFrom('proposed')).toEqual(expect.arrayContaining(['approve', 'decline']));
    expect(movesFrom('approved')).toEqual(expect.arrayContaining(['build']));
    expect(movesFrom('released')).toEqual([]);
    expect(movesFrom('executing')).toEqual([]);
  });

  it('approve and decline go through decide, build through start, the rest through triage', () => {
    expect(MOVES.approve.door).toBe('decide');
    expect(MOVES.decline.door).toBe('decide');
    expect(MOVES.build.door).toBe('start');
    expect(MOVES.build.arg).toBe('execute');
    for (const n of ['accept', 'rework', 'descope', 'reopen'] as const) expect(MOVES[n].door).toBe('triage');
  });

  it('only proposed and approved are in the Build queue; released and declined are terminal', () => {
    expect(STATUSES.filter((s) => STATUS[s].queue).sort()).toEqual(['approved', 'proposed']);
    expect(STATUS.released.terminal).toBe(true);
    expect(STATUS.declined.terminal).toBe(true);
    expect(STATUS.executing.terminal).toBe(false);
  });

  it('a failed build is accepted only with a note (the store refuses it otherwise)', () => {
    expect(MOVES.accept.note).toBe('when-failed');
    expect(MOVES.accept.from).toContain('failed');
  });
});

describe('keymap', () => {
  const all = KEYMAP.flatMap((b) => b.keys.map((k) => ({ key: k.length === 1 ? k.toLowerCase() : k, act: b.act })));

  it('binds no key twice', () => {
    const seen = new Map<string, string>();
    for (const { key, act } of all) {
      expect(seen.has(key), `${key} is bound to ${seen.get(key)} and ${act}`).toBe(false);
      seen.set(key, act);
    }
  });

  it('names each action once', () => {
    const acts = KEYMAP.map((b) => b.act);
    expect(new Set(acts).size).toBe(acts.length);
  });

  it('the three verbs of the queue are A, X and B; Esc and Backspace go back; Enter goes down', () => {
    expect(actOf('a')).toBe('approve');
    expect(actOf('A')).toBe('approve');
    expect(actOf('x')).toBe('decline');
    expect(actOf('b')).toBe('build');
    expect(actOf('Escape')).toBe('back');
    expect(actOf('Backspace')).toBe('back');
    expect(actOf('Enter')).toBe('enter');
    expect(actOf('?')).toBe('help');
    expect(actOf('z')).toBeUndefined();
  });

  it('digits 1 to 9 name the sheets: 1 General, 2.. the lenses', () => {
    expect(lensIndexOfKey('1')).toBe(0);
    expect(lensIndexOfKey('9')).toBe(8);
    expect(lensIndexOfKey('0')).toBeNull();
    for (let i = 1; i <= 9; i++) expect(actOf(String(i))).toBe('lens');
  });

  it('every action has its sentence in the English catalog', () => {
    const B = (en as { decisionCenter: { blueprint: Record<string, string> } }).decisionCenter.blueprint;
    for (const b of KEYMAP) {
      const key = 'key_' + b.act.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
      expect(B[key], key).toBeTruthy();
    }
  });

  it('every status has a word and a hint in the English catalog', () => {
    const B = (en as { decisionCenter: { blueprint: Record<string, string> } }).decisionCenter.blueprint;
    for (const s of STATUSES) { expect(B['status_' + s], s).toBeTruthy(); expect(B['next_' + s] !== undefined, s).toBe(true); }
  });
});
