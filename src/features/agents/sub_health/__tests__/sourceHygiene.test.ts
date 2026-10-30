// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

// Lives under __tests__/ (excluded from tsc, like every other test that reads
// the tree through node:fs) rather than beside the hook.
//
// The guard walks the whole directory instead of naming one file. It used to
// read only `useHealthCheck.ts`, but the template literal it was written for
// (makeIssueId's `\u0000` field separators) moved to `healthScoring.ts`, so the
// one file that can actually regress was the one file it never looked at.
const ROOT = resolve(process.cwd(), 'src/features/agents/sub_health');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('source hygiene', () => {
  const files = sourceFiles(ROOT);

  it('walks the files that carry the escaped separators', () => {
    // An empty or wrong walk would pass the byte check below vacuously.
    const names = files.map((f) => relative(ROOT, f).replace(/\\/g, '/'));
    expect(names).toContain('healthScoring.ts');
    expect(names).toContain('useHealthCheck.ts');
  });

  it('no source file in sub_health carries raw control bytes', () => {
    // A literal NUL inside makeIssueId's template literal made grep report the
    // file as binary (every `grep -n` over it returned zero lines) and made git
    // render it as `Bin` in every diff stat, so a change to the file had no
    // reviewable hunk. Escapes carry the same value; raw control bytes carry
    // none of that. vitest's import.meta.url is not a file: URL, so resolve
    // from the repo root.
    const offenders = files.filter((file) =>
      [...readFileSync(file)].some((b) => b < 0x09 || (b > 0x0d && b < 0x20)),
    ).map((f) => relative(ROOT, f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
