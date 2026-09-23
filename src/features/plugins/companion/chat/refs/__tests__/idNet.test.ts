import { describe, expect, it } from 'vitest';
import { isBareIdToken, shortenBareIds, shortenId } from '../idNet';

const UUID = '3f2b8c1a-9d4e-4f6a-8b7c-1e2d3f4a5b6c';

describe('isBareIdToken', () => {
  it('matches uuids, mixed hex runs and prefixed ids only', () => {
    expect(isBareIdToken(UUID)).toBe(true);
    expect(isBareIdToken('a1b2c3d4e5')).toBe(true);
    expect(isBareIdToken('appr_1a2b3c4d')).toBe(true);
    expect(isBareIdToken('deadbeef')).toBe(false); // no digit
    expect(isBareIdToken('12345678')).toBe(false); // no letter
    expect(isBareIdToken('facade')).toBe(false);
    expect(isBareIdToken('persona_thing')).toBe(false);
  });
});

describe('shortenBareIds', () => {
  it('shortens a uuid in prose', () => {
    expect(shortenBareIds(`Session ${UUID} finished.`)).toBe(`Session ${shortenId(UUID)} finished.`);
    expect(shortenId(UUID)).toBe('3f2b8c1a…');
  });

  it('shortens a git sha and a prefixed id', () => {
    expect(shortenBareIds('Commit 9f8e7d6c5b4a3f2e landed.')).toBe('Commit 9f8e7d6c… landed.');
    expect(shortenBareIds('Approval appr_1a2b3c4d5e6f waits.')).toBe('Approval appr_1a2… waits.');
  });

  it('shortens an inline code span that holds only an id', () => {
    expect(shortenBareIds(`Run \`${UUID}\` now`)).toBe(`Run \`3f2b8c1a…\` now`);
  });

  it('leaves other inline code, fenced blocks, ref links and URLs alone', () => {
    const code = '`git show 9f8e7d6c5b4a3f2e`';
    expect(shortenBareIds(code)).toBe(code);
    const fence = '```\nid = 9f8e7d6c5b4a3f2e\n```';
    expect(shortenBareIds(fence)).toBe(fence);
    const ref = `[that session](ref:session/${UUID})`;
    expect(shortenBareIds(ref)).toBe(ref);
    const url = 'See https://github.com/x/y/commit/9f8e7d6c5b4a3f2e for it.';
    expect(shortenBareIds(url)).toBe(url);
    const link = '[the diff](https://x.dev/9f8e7d6c5b4a3f2e)';
    expect(shortenBareIds(link)).toBe(link);
  });

  it('leaves ordinary words untouched', () => {
    const text = 'A well-known facade, 2026 and 12345678 stay.';
    expect(shortenBareIds(text)).toBe(text);
  });
});
