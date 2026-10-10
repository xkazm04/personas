// Declared builder paths: the overlap check that lets two builders of one project run side by side.
// It must be CONSERVATIVE: whatever it cannot prove disjoint, it calls overlapping.
// Run: node --test .claude/skills/appmaster/test/paths.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeOf, specsOverlap, overlappingPairs, pathsOverlap, specError } from '../lib/paths.mjs';

test('scopeOf: the literal directory part before the first glob character', () => {
  assert.deepEqual(scopeOf('src/app/org/'), ['src', 'app', 'org']);
  assert.deepEqual(scopeOf('./src//lib/a.ts'), ['src', 'lib', 'a.ts']);
  assert.deepEqual(scopeOf('src\\App\\x.ts'), ['src', 'app', 'x.ts'], 'backslashes and case are normalised');
  assert.deepEqual(scopeOf('src/app*'), ['src']);
  assert.deepEqual(scopeOf('docs/**/*.md'), ['docs']);
  assert.deepEqual(scopeOf('src/{a,b}/x.ts'), ['src']);
  assert.deepEqual(scopeOf('*.md'), []);
  assert.deepEqual(scopeOf('**'), []);
});

test('disjoint: different directories, different files, sibling prefixes that only share letters', () => {
  for (const [a, b] of [
    ['src/kpi/', 'src/app/'],
    ['src/lib/a.ts', 'src/lib/a.tsx'],
    ['src/app', 'src/apple'],
    ['docs/**/*.md', 'src/**/*.md'],
    ['prisma/schema.prisma', 'src/'],
  ]) {
    assert.equal(specsOverlap(a, b), false, `${a} vs ${b}`);
    assert.equal(specsOverlap(b, a), false, `${b} vs ${a} (symmetric)`);
  }
});

test('overlapping: nesting, equality, case, and every glob it cannot see through', () => {
  for (const [a, b] of [
    ['src/', 'src/app/page.tsx'],
    ['src/app', 'src/app/org/x.ts'],
    ['src/App/', 'SRC/app/x.ts'],
    ['src/a.ts', 'src/a.ts'],
    ['src/app*', 'src/apple/x.ts'],
    ['src/**/*.ts', 'src/**/*.md'],          // could be proved disjoint by extension, but is not trusted
    ['*.md', 'src/x.ts'],                     // a root glob covers the whole repo
    ['src/*/x.ts', 'src/a/y.ts'],
  ]) {
    assert.equal(specsOverlap(a, b), true, `${a} vs ${b}`);
    assert.equal(specsOverlap(b, a), true, `${b} vs ${a} (symmetric)`);
  }
});

test('lists: an empty or absent list is the whole repo; every overlapping pair is reported', () => {
  assert.equal(pathsOverlap(['src/a/'], ['src/b/', 'docs/']), false);
  assert.equal(pathsOverlap(['src/a/'], []), true);
  assert.equal(pathsOverlap(undefined, ['src/b/']), true);
  assert.deepEqual(overlappingPairs(['src/a/', 'docs/x.md'], ['docs/', 'src/b/']), [['docs/x.md', 'docs/']]);
  assert.deepEqual(overlappingPairs([], ['x/']), [['*', 'x/']]);
});

test('specError: repo-relative paths and globs only', () => {
  for (const ok of ['src/', 'src/a.ts', 'docs/**/*.md', '*.md', './src/x']) assert.equal(specError(ok), null, ok);
  assert.match(specError(''), /non-empty/);
  assert.match(specError('src/my file.ts'), /whitespace/);
  assert.match(specError('C:/repo/src'), /repo-relative/);
  assert.match(specError('/etc/passwd'), /repo-relative/);
  assert.match(specError('src/../../x'), /climb/);
  assert.match(specError('!src/'), /negated/);
  assert.match(specError(5), /non-empty string/);
});
