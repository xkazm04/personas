import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { head, dirty, statusFingerprint } from '../../scripts/test/lib/git.mjs';

let repo;
const g = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

describe('git helpers (temp repo)', () => {
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'eval-git-test-'));
    g('init', '-q');
    g('config', 'user.email', 't@t.test');
    g('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'a.txt'), 'hello\n');
    g('add', 'a.txt');
    g('commit', '-q', '-m', 'init');
  });
  afterAll(() => {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  });

  it('head() returns a 40-hex HEAD sha', () => {
    expect(head(repo)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('clean tree → dirty false, fingerprint empty', () => {
    expect(dirty(repo)).toBe(false);
    expect(statusFingerprint(repo)).toBe('');
  });

  it('detects an uncommitted change while HEAD is unchanged', () => {
    const before = head(repo);
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    expect(dirty(repo)).toBe(true);
    expect(statusFingerprint(repo)).toContain('a.txt');
    expect(head(repo)).toBe(before); // the exact gap statusFingerprint closes
  });

  it('returns null on a non-repo path', () => {
    expect(head('/__not_a_repo__')).toBeNull();
    expect(dirty('/__not_a_repo__')).toBeNull();
    expect(statusFingerprint('/__not_a_repo__')).toBeNull();
  });
});
