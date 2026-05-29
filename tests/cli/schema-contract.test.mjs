import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateScorecard, validateRun } from '../../scripts/test/lib/schema.mjs';

// Validate every committed bundle in docs/test/runs/ against the shared schema.
// This is the cross-language contract guard: if the harness ever changes the
// bundle shape in a way that would break the Rust reader (eval_runs.rs), this
// fails first. Run dirs are those containing scorecard.json or run.json.
const RUNS = join('docs', 'test', 'runs');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function runDirs() {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS)
    .map((name) => join(RUNS, name))
    .filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
}

const dirs = runDirs();
const withScorecard = dirs.filter((d) => existsSync(join(d, 'scorecard.json')));
const withRun = dirs.filter((d) => existsSync(join(d, 'run.json')));

describe('committed bundle schema contract', () => {
  it('finds a meaningful number of run bundles', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(20);
    expect(withScorecard.length).toBeGreaterThan(0);
  });

  it.each(withScorecard)('scorecard.json validates: %s', (dir) => {
    const errs = validateScorecard(readJson(join(dir, 'scorecard.json')));
    expect(errs, `${dir}: ${errs.join('; ')}`).toEqual([]);
  });

  it.each(withRun)('run.json validates: %s', (dir) => {
    const errs = validateRun(readJson(join(dir, 'run.json')));
    expect(errs, `${dir}: ${errs.join('; ')}`).toEqual([]);
  });
});
