import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Lives under __tests__/ (excluded from tsc, like every other test that reads
// the tree through node:fs) rather than beside the hook.
describe('source hygiene', () => {
  it('useHealthCheck.ts carries no raw control bytes', () => {
    // A literal NUL inside makeIssueId's template literal made grep report the
    // file as binary (every `grep -n` over it returned zero lines) and made git
    // render it as `Bin` in every diff stat, so a change to this file had no
    // reviewable hunk. Escapes carry the same value; raw control bytes carry
    // none of that. vitest's import.meta.url is not a file: URL, so resolve
    // from the repo root.
    const src = readFileSync(resolve(process.cwd(), 'src/features/agents/sub_health/useHealthCheck.ts'));
    const control = [...src].filter((b) => b < 0x09 || (b > 0x0d && b < 0x20));
    expect(control).toEqual([]);
  });
});
