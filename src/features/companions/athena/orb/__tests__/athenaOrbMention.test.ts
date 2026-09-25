import { describe, it, expect } from 'vitest';
import { resolveMention, splitOnMention } from '../athenaOrbMention';

/**
 * The resolver's job is to REFUSE, not to guess.
 *
 * A link that jumps the board to the wrong node is worse than no link: the
 * operator loses their place and stops trusting the affordance. So the
 * interesting cases here are the ones that must return null, and they outnumber
 * the happy path deliberately.
 */

const CANDIDATES = [
  { key: 'p:1', name: 'Dev Clone' },
  { key: 'p:2', name: 'QA Guardian' },
  { key: 's:9', name: 'refactor auth' },
];

describe('resolveMention', () => {
  it('links the one entity a sentence unambiguously names', () => {
    const m = resolveMention('Dev Clone is blocked on a credential scope.', CANDIDATES);
    expect(m?.key).toBe('p:1');
    expect(m?.label).toBe('Dev Clone');
  });

  it('matches case-insensitively but returns the caption\'s own casing', () => {
    // The rendered link must be the reader's substring, not a re-cased copy —
    // otherwise the sentence visibly changes when a link appears in it.
    const m = resolveMention('i think dev clone needs you.', CANDIDATES);
    expect(m?.key).toBe('p:1');
    expect(m?.label).toBe('dev clone');
  });

  it('REFUSES when two candidates both appear', () => {
    // The rule that does most of the work. Silently taking the first is exactly
    // how a link ends up pointing somewhere wrong.
    expect(
      resolveMention('Dev Clone and QA Guardian disagree about the rollout.', CANDIDATES),
    ).toBeNull();
  });

  it('REFUSES a substring that is not its own word', () => {
    expect(resolveMention('the refactor authorisation flow stalled', CANDIDATES)).toBeNull();
  });

  it('REFUSES names below the length floor', () => {
    // "Ops" collides with ordinary prose constantly; below the floor a name is
    // not evidence that she meant the entity.
    expect(resolveMention('ops looks fine', [{ key: 'p:3', name: 'Ops' }])).toBeNull();
  });

  it('treats a hyphen as a word boundary, so a real project name still matches', () => {
    const m = resolveMention('ai-bookkeeper finished its run.', [
      { key: 'p:4', name: 'ai-bookkeeper' },
    ]);
    expect(m?.key).toBe('p:4');
  });

  it('does not blow up on a name containing regex metacharacters', () => {
    // Names are user data. An unescaped `(` here would throw, and a throw in the
    // orb takes down an overlay mounted on every screen in the app.
    expect(() =>
      resolveMention('watch build (api) closely', [{ key: 's:1', name: 'build (api)' }]),
    ).not.toThrow();
    expect(
      resolveMention('watch build (api) closely', [{ key: 's:1', name: 'build (api)' }])?.key,
    ).toBe('s:1');
  });

  it('returns null for an empty caption or an empty roster', () => {
    expect(resolveMention(null, CANDIDATES)).toBeNull();
    expect(resolveMention('anything at all', [])).toBeNull();
  });
});

describe('splitOnMention', () => {
  it('splits around the match so the link is rendered in place', () => {
    const caption = 'Dev Clone is blocked.';
    const parts = splitOnMention(caption, resolveMention(caption, CANDIDATES));
    expect(parts).toEqual({ before: '', label: 'Dev Clone', after: ' is blocked.' });
    // The three pieces must reconstruct the caption exactly — a renderer that
    // drops or duplicates a character would be silently editing what she said.
    expect(`${parts!.before}${parts!.label}${parts!.after}`).toBe(caption);
  });

  it('returns null with no mention, so the caller renders plain prose', () => {
    expect(splitOnMention('nothing to link here', null)).toBeNull();
  });
});
