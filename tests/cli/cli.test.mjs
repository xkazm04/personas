import { describe, it, expect } from 'vitest';
import { makeArg, has } from '../../scripts/test/lib/cli.mjs';

const ARGV = ['node', 'script', '--run', 'abc', '--flag', '--other', '--run-only', '--empty', ''];

describe('makeArg — lax (default)', () => {
  const arg = makeArg(ARGV, { strict: false });
  it('returns the token after the name', () => {
    expect(arg('--run')).toBe('abc');
  });
  it('returns a following --flag token (does NOT reject it)', () => {
    expect(arg('--flag')).toBe('--other');
  });
  it('missing name → fallback', () => {
    expect(arg('--nope')).toBeNull();
    expect(arg('--nope', 'd')).toBe('d');
  });
  it('empty-string token → fallback (falsy)', () => {
    expect(arg('--empty', 'd')).toBe('d');
  });
});

describe('makeArg — strict', () => {
  const arg = makeArg(ARGV, { strict: true });
  it('returns a normal token', () => {
    expect(arg('--run')).toBe('abc');
  });
  it('rejects a following --flag token → fallback', () => {
    expect(arg('--flag', 'FB')).toBe('FB');
  });
  it('name present but no following token → fallback', () => {
    const a = makeArg(['node', 's', '--run'], { strict: true });
    expect(a('--run', 'd')).toBe('d');
  });
});

describe('has', () => {
  it('detects flag presence', () => {
    expect(has('--flag', ARGV)).toBe(true);
    expect(has('--missing', ARGV)).toBe(false);
  });
});
