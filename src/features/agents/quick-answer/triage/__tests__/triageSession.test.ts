/**
 * The deck's memory.
 *
 * Every property here is one the deck was missing, and the last three are the
 * ones that make persistence safe rather than merely present:
 *
 *  • two hooks write two halves of one record and must not clobber each other;
 *  • an expired, corrupt or unreadable record must read as a FRESH session, not
 *    as an error — the deck has to open even when its memory does not;
 *  • nothing may grow without a bound, because the collection that blows the
 *    origin quota takes the whole record down with it.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  clearTriageSession,
  loadTriageSession,
  resetTriageSessionCache,
  saveTriageSession,
  SESSION_TTL_MS,
} from '../triageSession';

const KEY = 'personas.triage.session.v1';

/** Write a record straight to storage, as a previous sitting would have. */
function seed(record: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify(record));
  resetTriageSessionCache();
}

beforeEach(() => {
  localStorage.clear();
  resetTriageSessionCache();
});

describe('triageSession — the round trip', () => {
  it('returns a usable empty session when nothing was ever stored', () => {
    const session = loadTriageSession();
    expect(session.skips.size).toBe(0);
    expect(session.resolved.size).toBe(0);
    expect(session.drafts).toEqual({});
    // null, not "everything": a reviewer who never touched the filter must get
    // the deck's default, not a snapshot of it.
    expect(session.kinds).toBeNull();
  });

  it('restores skips, kinds, drafts and resolved ids across a close', () => {
    saveTriageSession({
      skips: new Map([['idea:1', 2]]),
      kinds: new Set(['practice'] as const),
      drafts: { 'sess-1::tools': 'gmail' },
      resolved: new Set(['idea:9']),
    });
    resetTriageSessionCache();

    const session = loadTriageSession();
    expect(session.skips.get('idea:1')).toBe(2);
    expect([...(session.kinds ?? [])]).toEqual(['practice']);
    expect(session.drafts).toEqual({ 'sess-1::tools': 'gmail' });
    expect(session.resolved.has('idea:9')).toBe(true);
  });

  it('MERGES partial writes — the two hooks own different halves', () => {
    // `useUnifiedTriage` owns skips/kinds/resolved; `useDeckControls` owns
    // drafts. Neither may be able to erase the other's work by saving its own.
    saveTriageSession({ skips: new Map([['idea:1', 1]]) });
    saveTriageSession({ drafts: { 'sess-1::tools': 'half a sen' } });
    saveTriageSession({ skips: new Map([['idea:1', 2]]) });
    resetTriageSessionCache();

    const session = loadTriageSession();
    expect(session.skips.get('idea:1')).toBe(2);
    expect(session.drafts['sess-1::tools']).toBe('half a sen');
  });

  it('keeps one startedAt across writes — the session summary needs a window', () => {
    saveTriageSession({ skips: new Map() });
    const first = loadTriageSession().startedAt;
    saveTriageSession({ drafts: { a: 'b' } });
    resetTriageSessionCache();
    expect(loadTriageSession().startedAt).toBe(first);
  });

  it('forgets everything on clear — what "show me the world again" means', () => {
    saveTriageSession({ skips: new Map([['idea:1', 2]]), resolved: new Set(['idea:9']) });
    clearTriageSession();
    const session = loadTriageSession();
    expect(session.skips.size).toBe(0);
    expect(session.resolved.size).toBe(0);
  });
});

describe('triageSession — a stored record that must NOT be trusted', () => {
  it('expires a session older than the TTL rather than resurrecting deferrals', () => {
    // "Not now" has a now. Bringing back last Tuesday's skips would make the
    // deck permanently smaller than the queue.
    seed({
      v: 1,
      at: Date.now() - SESSION_TTL_MS - 1000,
      startedAt: Date.now() - SESSION_TTL_MS - 1000,
      skips: [['idea:1', 2]],
      kinds: ['idea'],
      drafts: [],
      resolved: ['idea:9'],
    });
    const session = loadTriageSession();
    expect(session.skips.size).toBe(0);
    expect(session.resolved.size).toBe(0);
    expect(session.kinds).toBeNull();
  });

  it('discards a record from a different version rather than migrating it', () => {
    seed({ v: 99, at: Date.now(), skips: [['idea:1', 2]] });
    expect(loadTriageSession().skips.size).toBe(0);
  });

  it('reads corrupt JSON as a fresh session instead of throwing', () => {
    localStorage.setItem(KEY, '{not json');
    resetTriageSessionCache();
    expect(() => loadTriageSession()).not.toThrow();
    expect(loadTriageSession().skips.size).toBe(0);
  });

  it('drops a kind the app no longer has', () => {
    seed({
      v: 1,
      at: Date.now(),
      startedAt: Date.now(),
      skips: [],
      kinds: ['idea', 'telepathy'],
      drafts: [],
      resolved: [],
    });
    expect([...(loadTriageSession().kinds ?? [])]).toEqual(['idea']);
  });
});

describe('triageSession — bounds', () => {
  it('caps the skip ledger, keeping the most recent deferrals', () => {
    const skips = new Map<string, number>();
    for (let i = 0; i < 500; i += 1) skips.set(`idea:${i}`, 1);
    saveTriageSession({ skips });
    resetTriageSessionCache();

    const restored = loadTriageSession().skips;
    expect(restored.size).toBe(400);
    // Oldest dropped, newest kept: the deferral you just made is the one you
    // are most likely to be shown again.
    expect(restored.has('idea:0')).toBe(false);
    expect(restored.has('idea:499')).toBe(true);
  });

  it('does not store empty drafts, and truncates a runaway one', () => {
    saveTriageSession({ drafts: { empty: '', long: 'x'.repeat(9000) } });
    resetTriageSessionCache();
    const drafts = loadTriageSession().drafts;
    expect(drafts.empty).toBeUndefined();
    expect(drafts.long?.length).toBe(4000);
  });
});
