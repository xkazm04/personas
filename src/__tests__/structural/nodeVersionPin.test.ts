// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `engines.node` is a claim about which Node the repo works on. It said `>=20`
 * while `.nvmrc` and every CI job ran 22, and `test:devlog` handed an unquoted
 * glob to `node --test`: on Windows cmd.exe does not expand it, and Node only
 * expands `--test` globs itself from 21, so the script failed on Node 20 on
 * Windows while Linux CI stayed green. The floor is the version actually tested,
 * and `node --test` globs are quoted so Node, not the shell, expands them.
 */
const REPO = resolve(__dirname, '../../..');
const pkg = JSON.parse(readFileSync(resolve(REPO, 'package.json'), 'utf8')) as {
  engines: { node: string };
  scripts: Record<string, string>;
};

describe('the Node version the repo claims', () => {
  it('engines.node floor is the .nvmrc major that CI runs', () => {
    const nvmrcMajor = Number(readFileSync(resolve(REPO, '.nvmrc'), 'utf8').trim().split('.')[0]);
    const floor = /^>=\s*(\d+)/.exec(pkg.engines.node);
    expect(floor, `engines.node "${pkg.engines.node}" is not a >= floor`).not.toBeNull();
    expect(Number(floor![1])).toBe(nvmrcMajor);
  });

  it('every node --test glob is quoted so the shell does not have to expand it', () => {
    const unquoted = Object.entries(pkg.scripts).filter(([, cmd]) =>
      /node --test(?:\s+--\S+)*\s+[^"'\s]*\*/.test(cmd),
    );
    expect(unquoted.map(([name]) => name)).toEqual([]);
  });
});
