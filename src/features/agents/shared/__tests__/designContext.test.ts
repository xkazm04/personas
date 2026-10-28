// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { mergeCredentialLink, parseDesignContext, serializeDesignContext } from '../designContext';

/**
 * `parseDesignContext` is the one reader of every persona's `design_context`
 * blob (nine modules import it), and until this file it was asserted only in
 * passing, by one hook test that fed it a legacy envelope. Each case below
 * pins one branch so that flipping a comparison, swapping `&&`/`||` or
 * dropping a guard in the parser changes an assertion here. That is the
 * mutant set `scripts/mutation/run-mutation.mjs` applies; see
 * `docs/development/mutation-testing.md`.
 *
 * The parser caches by raw string, so every case uses a raw string no other
 * case uses.
 */

describe('parseDesignContext: empty input', () => {
  it('returns one shared frozen object for null, undefined, empty and whitespace', () => {
    const empty = parseDesignContext(null);
    expect(empty).toEqual({});
    expect(Object.isFrozen(empty)).toBe(true);
    expect(parseDesignContext(undefined)).toBe(empty);
    expect(parseDesignContext('')).toBe(empty);
    expect(parseDesignContext('  \n\t ')).toBe(empty);
  });
});

describe('parseDesignContext: input that is not an envelope', () => {
  it('treats invalid JSON as a summary', () => {
    expect(parseDesignContext('plain text, not json {')).toEqual({ summary: 'plain text, not json {' });
  });

  it('treats JSON that is not an object as a summary', () => {
    expect(parseDesignContext('42')).toEqual({ summary: '42' });
    expect(parseDesignContext('null')).toEqual({ summary: 'null' });
    expect(parseDesignContext('[1,2]')).toEqual({ summary: '[1,2]' });
    expect(parseDesignContext('"quoted"')).toEqual({ summary: '"quoted"' });
  });

  it('returns an empty envelope for an object with no known key', () => {
    const parsed = parseDesignContext('{"unrelated":1}');
    expect(parsed).toEqual({});
    expect(Object.isFrozen(parsed)).toBe(false);
  });
});

describe('parseDesignContext: camelCase envelope', () => {
  it('is recognised by any one of its three keys and returned as stored', () => {
    expect(parseDesignContext('{"designFiles":{"files":[],"references":["r"]}}')).toEqual({
      designFiles: { files: [], references: ['r'] },
    });
    expect(parseDesignContext('{"credentialLinks":{"slack":"cred-1"}}')).toEqual({ credentialLinks: { slack: 'cred-1' } });
    expect(parseDesignContext('{"useCases":[],"summary":"kept"}')).toEqual({ useCases: [], summary: 'kept' });
  });

  it('expands string use cases into DesignUseCase objects', () => {
    const parsed = parseDesignContext('{"useCases":["Triage inbox","Post digest"]}');
    expect(parsed.useCases).toEqual([
      { id: 'uc-0', title: 'Triage inbox', description: 'Triage inbox', category: 'general', execution_mode: 'mock' },
      { id: 'uc-1', title: 'Post digest', description: 'Post digest', category: 'general', execution_mode: 'mock' },
    ]);
  });

  it('truncates a title only past 80 characters', () => {
    const exactly80 = 'a'.repeat(80);
    const over80 = 'b'.repeat(81);
    const parsed = parseDesignContext(JSON.stringify({ useCases: [exactly80, over80] }));
    expect(parsed.useCases?.[0]?.title).toBe(exactly80);
    expect(parsed.useCases?.[1]?.title).toBe(`${'b'.repeat(80)}...`);
    expect(parsed.useCases?.[1]?.description).toBe(over80);
  });

  it('leaves object use cases untouched', () => {
    const useCase = { id: 'u1', title: 'T', description: 'D', category: 'ops', execution_mode: 'live' };
    expect(parseDesignContext(JSON.stringify({ useCases: [useCase] })).useCases).toEqual([useCase]);
  });
});

describe('parseDesignContext: legacy snake_case envelope', () => {
  it('migrates top-level files and references into designFiles, defaulting the missing one', () => {
    expect(parseDesignContext('{"files":[{"name":"a.md"}]}')).toEqual({
      designFiles: { files: [{ name: 'a.md' }], references: [] },
    });
    expect(parseDesignContext('{"references":["https://x"]}')).toEqual({
      designFiles: { files: [], references: ['https://x'] },
    });
  });

  it('migrates credential_links only when it is an object', () => {
    expect(parseDesignContext('{"credential_links":{"github":"cred-9"}}')).toEqual({ credentialLinks: { github: 'cred-9' } });
    expect(parseDesignContext('{"credential_links":null}')).toEqual({});
    expect(parseDesignContext('{"credential_links":"cred-9"}')).toEqual({});
  });

  it('migrates use_cases only when it is an array', () => {
    expect(parseDesignContext('{"use_cases":[{"id":"x"}]}')).toEqual({ useCases: [{ id: 'x' }] });
    expect(parseDesignContext('{"use_cases":{"id":"x"}}')).toEqual({});
  });

  it('keeps summary only when it is a non-empty string', () => {
    expect(parseDesignContext('{"summary":"does things"}')).toEqual({ summary: 'does things' });
    expect(parseDesignContext('{"summary":""}')).toEqual({});
    expect(parseDesignContext('{"summary":7}')).toEqual({});
  });

  it('migrates every legacy key at once', () => {
    expect(
      parseDesignContext('{"files":[],"references":["r1"],"credential_links":{"s":"c"},"use_cases":[],"summary":"all"}'),
    ).toEqual({
      designFiles: { files: [], references: ['r1'] },
      credentialLinks: { s: 'c' },
      useCases: [],
      summary: 'all',
    });
  });
});

describe('parseDesignContext: cache', () => {
  const raw = (tag: string, i: number) => JSON.stringify({ summary: `${tag}-${i}` });

  it('returns the same reference for the same raw string', () => {
    const first = parseDesignContext(raw('same', 0));
    expect(parseDesignContext(raw('same', 0))).toBe(first);
    expect(parseDesignContext(raw('same', 1))).not.toBe(first);
  });

  it('evicts the least recently used entry beyond 32', () => {
    const first = parseDesignContext(raw('evict', 0));
    for (let i = 1; i <= 32; i++) parseDesignContext(raw('evict', i));
    const again = parseDesignContext(raw('evict', 0));
    expect(again).toEqual(first);
    expect(again).not.toBe(first);
  });

  it('a hit refreshes the entry, so it outlives entries parsed after it', () => {
    const first = parseDesignContext(raw('refresh', 0));
    for (let i = 1; i <= 31; i++) parseDesignContext(raw('refresh', i));
    expect(parseDesignContext(raw('refresh', 0))).toBe(first);
    parseDesignContext(raw('refresh', 32));
    expect(parseDesignContext(raw('refresh', 0))).toBe(first);
  });
});

describe('serializeDesignContext and mergeCredentialLink', () => {
  it('serializes to JSON that parses back to the same envelope', () => {
    const data = { summary: 'round trip', credentialLinks: { a: '1' } };
    expect(JSON.parse(serializeDesignContext(data))).toEqual(data);
  });

  it('adds a link to an empty context', () => {
    expect(JSON.parse(mergeCredentialLink(null, 'slack', 'cred-1'))).toEqual({ credentialLinks: { slack: 'cred-1' } });
  });

  it('adds beside existing links, overwrites the same connector, and keeps other fields', () => {
    const existing = '{"credentialLinks":{"slack":"old","github":"g"},"summary":"merge me"}';
    expect(JSON.parse(mergeCredentialLink(existing, 'slack', 'new'))).toEqual({
      credentialLinks: { slack: 'new', github: 'g' },
      summary: 'merge me',
    });
  });

  it('does not mutate the cached parse of its input', () => {
    const existing = '{"credentialLinks":{"jira":"j"},"summary":"untouched"}';
    const before = parseDesignContext(existing);
    mergeCredentialLink(existing, 'linear', 'l');
    expect(parseDesignContext(existing)).toBe(before);
    expect(before.credentialLinks).toEqual({ jira: 'j' });
  });
});
