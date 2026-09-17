import { describe, it, expect } from 'vitest';
import en from '@/i18n/locales/en.json';
import { ERROR_KEY_MAP } from '@/i18n/useTranslatedError';
import { ERROR_RULES } from '@/lib/errors/errorRegistry';

/**
 * GATE OVER TWO ORDERED MATCH LISTS — the sibling of
 * `chainStopReasons.parity.test.ts`, which refuses a hand-copied vocabulary.
 *
 * The error pipeline has two of them. `ERROR_RULES` (errorRegistry) holds the
 * English friendly copy; `ERROR_KEY_MAP` (useTranslatedError) holds the same
 * matches paired with an `error_registry.<prefix>` key so the copy can be
 * translated. `resolveErrorTranslated` walks the key map first and, on a miss,
 * chains into `resolveError` and returns its ENGLISH text - deliberately, as a
 * fallback, and silently.
 *
 * So a rule added only to the registry ships English to all 13 non-English
 * locales with a green board. `check-error-registry-parity.mjs` already gates
 * the other direction (every keyPrefix has its en.json keys); nothing compared
 * the two match lists until this file.
 *
 * Both modules export their array rather than having it parsed out of source:
 * a regex over a `RegExp` literal is exactly the brittle comparison this test
 * exists to replace.
 */

/** A match's identity, comparable across the two lists. */
const matchKey = (match: string | RegExp): string =>
  typeof match === 'string' ? `str:${match}` : `re:${match.source}\u0000${match.flags}`;

describe('ERROR_RULES <-> ERROR_KEY_MAP parity', () => {
  it('finds both lists it claims to gate', () => {
    // failure-not-empty-success: two empty arrays agree about everything.
    expect(ERROR_KEY_MAP.length).toBeGreaterThan(50);
    expect(ERROR_RULES.length).toBeGreaterThan(50);
  });

  it('every ERROR_RULES match has a translated twin in ERROR_KEY_MAP', () => {
    const translated = new Set(ERROR_KEY_MAP.map((r) => matchKey(r.match)));
    const untranslated = ERROR_RULES.map((r) => r.match).filter(
      (m) => !translated.has(matchKey(m)),
    );
    // Naming the offenders is the point: the failure message has to say which
    // rule will ship English, or the next author has to re-derive it.
    expect(untranslated.map(String)).toEqual([]);
  });

  it('every ERROR_KEY_MAP prefix has its catalog message and suggestion', () => {
    const registry = en.error_registry as Record<string, string>;
    const missing = ERROR_KEY_MAP.flatMap((r) => [
      registry[`${r.keyPrefix}_message`] ? null : `${r.keyPrefix}_message`,
      registry[`${r.keyPrefix}_suggestion`] ? null : `${r.keyPrefix}_suggestion`,
    ]).filter((k): k is string => k !== null);
    expect(missing).toEqual([]);
  });

  it('the two lists agree on category for every shared match', () => {
    const byMatch = new Map(ERROR_RULES.map((r) => [matchKey(r.match), r.error.category]));
    const disagreements = ERROR_KEY_MAP.filter((r) => {
      const registryCategory = byMatch.get(matchKey(r.match));
      return registryCategory !== undefined && registryCategory !== r.category;
    }).map((r) => `${r.keyPrefix}: key-map=${r.category} registry=${byMatch.get(matchKey(r.match))}`);
    // A rule that is `recoverable` in one list and `user_action` in the other
    // changes whether the UI offers a retry, purely on which door resolved it.
    expect(disagreements).toEqual([]);
  });

  it('no keyPrefix is claimed twice', () => {
    const seen = new Set<string>();
    const dupes = ERROR_KEY_MAP.map((r) => r.keyPrefix).filter((p) => {
      if (seen.has(p)) return true;
      seen.add(p);
      return false;
    });
    // The walk returns on first match, so a duplicate prefix means one of the
    // two rules can never be reached and its keys are dead weight.
    expect(dupes).toEqual([]);
  });
});
