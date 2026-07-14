import { describe, it, expect } from 'vitest';
import type { SidebarSection } from '@/lib/types/types';
import {
  EMPTY_NAV_STACKS,
  NAV_HISTORY_CAP,
  recordNavigation,
  goBack,
  goForward,
  canGoBack,
  canGoForward,
  sameDestination,
  type NavStacks,
  type NavDestination,
  type GatePredicate,
} from './history';

/** Terse destination constructor. */
const d = (section: SidebarSection, personaId: string | null = null): NavDestination => ({
  section,
  personaId,
});

/** Reduce a sequence of section visits into stacks (each visit records the prior). */
function walk(sections: SidebarSection[]): { stacks: NavStacks; current: NavDestination } {
  let stacks = EMPTY_NAV_STACKS;
  let current = d(sections[0]!);
  for (const s of sections.slice(1)) {
    stacks = recordNavigation(stacks, current);
    current = d(s);
  }
  return { stacks, current };
}

describe('nav history — recordNavigation', () => {
  it('pushes the outgoing location onto the back stack (newest-first)', () => {
    let s = recordNavigation(EMPTY_NAV_STACKS, d('home'));
    s = recordNavigation(s, d('overview'));
    expect(s.back.map((e) => e.section)).toEqual(['overview', 'home']);
    expect(s.forward).toEqual([]);
  });

  it('dedupes the consecutive head (no-op when re-recording the same head)', () => {
    const s1 = recordNavigation(EMPTY_NAV_STACKS, d('home'));
    const s2 = recordNavigation(s1, d('home'));
    expect(s2).toBe(s1); // same reference — nothing changed
    expect(s2.back.length).toBe(1);
  });

  it('dedupes are persona-aware (same section, different agent is NOT a dupe)', () => {
    let s = recordNavigation(EMPTY_NAV_STACKS, d('personas', 'a'));
    s = recordNavigation(s, d('personas', 'b'));
    expect(s.back.map((e) => e.personaId)).toEqual(['b', 'a']);
  });

  it('caps the back stack at NAV_HISTORY_CAP, dropping the oldest', () => {
    let s = EMPTY_NAV_STACKS;
    for (let i = 0; i < NAV_HISTORY_CAP + 10; i++) {
      s = recordNavigation(s, d('personas', String(i)));
    }
    expect(s.back.length).toBe(NAV_HISTORY_CAP);
    // Newest-first: head is the last recorded, tail dropped the earliest.
    expect(s.back[0]!.personaId).toBe(String(NAV_HISTORY_CAP + 9));
  });

  it('truncates the forward branch on a new navigation (browser semantics)', () => {
    // home -> overview -> personas, then back twice, then a NEW nav to credentials.
    const { stacks, current } = walk(['home', 'overview', 'personas']);
    const b1 = goBack(stacks, current)!; // -> overview (forward: [personas])
    const b2 = goBack(b1.stacks, b1.dest)!; // -> home (forward: [overview, personas])
    expect(b2.stacks.forward.map((e) => e.section)).toEqual(['overview', 'personas']);
    // New navigation from home -> credentials wipes the forward branch and
    // records only the location left behind (home). The un-retraced
    // overview/personas branch is gone — exactly like a browser.
    const after = recordNavigation(b2.stacks, b2.dest);
    expect(after.forward).toEqual([]);
    expect(after.back.map((e) => e.section)).toEqual(['home']);
  });
});

describe('nav history — goBack / goForward cursor semantics', () => {
  it('goBack returns the previous location and stashes current onto forward', () => {
    const { stacks, current } = walk(['home', 'overview']); // current = overview, back=[home]
    const res = goBack(stacks, current)!;
    expect(res.dest).toEqual(d('home'));
    expect(res.stacks.back).toEqual([]);
    expect(res.stacks.forward.map((e) => e.section)).toEqual(['overview']);
  });

  it('goForward is the exact inverse of goBack', () => {
    const { stacks, current } = walk(['home', 'overview', 'personas']);
    const b = goBack(stacks, current)!; // -> overview
    const f = goForward(b.stacks, b.dest)!; // -> personas again
    expect(f.dest).toEqual(d('personas'));
    // Round-trip restores the original stacks.
    expect(f.stacks.back.map((e) => e.section)).toEqual(stacks.back.map((e) => e.section));
    expect(f.stacks.forward).toEqual([]);
  });

  it('goBack returns null at the root; goForward returns null with no forward', () => {
    expect(goBack(EMPTY_NAV_STACKS, d('home'))).toBeNull();
    expect(goForward(EMPTY_NAV_STACKS, d('home'))).toBeNull();
  });

  it('canGoBack / canGoForward reflect availability', () => {
    const { stacks, current } = walk(['home', 'overview']);
    expect(canGoBack(stacks)).toBe(true);
    expect(canGoForward(stacks)).toBe(false);
    const b = goBack(stacks, current)!;
    expect(canGoBack(b.stacks)).toBe(false);
    expect(canGoForward(b.stacks)).toBe(true);
  });
});

describe('nav history — gate skipping', () => {
  // 'events' is treated as gated (e.g. tier dropped below its minTier).
  const gateEvents: GatePredicate = (dest) => dest.section === 'events';

  it('goBack skips a now-gated entry and lands on the next reachable one', () => {
    // back stack (newest-first): [events, home]; current = personas.
    const stacks: NavStacks = { back: [d('events'), d('home')], forward: [] };
    const res = goBack(stacks, d('personas'), gateEvents)!;
    expect(res.dest).toEqual(d('home')); // events skipped
    expect(res.stacks.back).toEqual([]); // both events + home consumed past
    // The gated 'events' entry is discarded, NOT parked on forward.
    expect(res.stacks.forward.map((e) => e.section)).toEqual(['personas']);
  });

  it('goForward skips a now-gated forward entry', () => {
    const stacks: NavStacks = { back: [], forward: [d('events'), d('overview')] };
    const res = goForward(stacks, d('home'), gateEvents)!;
    expect(res.dest).toEqual(d('overview'));
    expect(res.stacks.forward).toEqual([]);
  });

  it('canGoBack is false when every back entry is gated', () => {
    const stacks: NavStacks = { back: [d('events'), d('events')], forward: [] };
    expect(canGoBack(stacks, gateEvents)).toBe(false);
    expect(goBack(stacks, d('home'), gateEvents)).toBeNull();
  });
});

describe('nav history — sameDestination', () => {
  it('compares section and personaId', () => {
    expect(sameDestination(d('personas', 'x'), d('personas', 'x'))).toBe(true);
    expect(sameDestination(d('personas', 'x'), d('personas', 'y'))).toBe(false);
    expect(sameDestination(d('personas'), d('home'))).toBe(false);
  });
});
