// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

// The D9 control through its real entry point, in a scratch repo, with a planted key staged. The
// verdicts hold with or without gitleaks on the machine: the token is shaped for its default rules too.
const SCRIPT = resolve('scripts/secret-scan.mjs');
// Assembled at runtime so that this file holds no key shape.
const TOKEN = ['gh', 'p_', 'k3Jd9QzX7mVb2LpR8sNw4TgY6cHf1UeA0oIy'].join('');

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function scanStaged(path: string, content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'secret-scan-'));
  dirs.push(dir);
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  copyFileSync(resolve('.gitleaks.toml'), join(dir, '.gitleaks.toml'));
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
  git('add', '.');
  const res = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

describe('scripts/secret-scan.mjs', () => {
  it('blocks a staged key and names the file, not the key', () => {
    const { status, output } = scanStaged('src/config.ts', `export const key = '${TOKEN}';\n`);
    expect(status).toBe(1);
    expect(output).toContain('src/config.ts');
    expect(output).not.toContain(TOKEN);
  });

  it('passes a clean staged file', () => {
    expect(scanStaged('src/config.ts', 'export const key = process.env.KEY;\n').status).toBe(0);
  });

  it('passes a key shape on a path the gitleaks allowlist exempts', () => {
    expect(scanStaged('fixtures/redact.json', `{"key":"${TOKEN}"}\n`).status).toBe(0);
  });

  it('passes a line marked gitleaks:allow', () => {
    expect(scanStaged('src/redact.rs', `let k = "${TOKEN}"; // gitleaks:allow\n`).status).toBe(0);
  });
});
