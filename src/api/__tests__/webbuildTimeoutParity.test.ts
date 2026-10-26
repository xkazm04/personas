// @vitest-environment node
// Studio's long webbuild calls each run under a backend budget, and a wrapper
// that gives up first reports a failure while the backend finishes anyway:
// a sketch that lands after the UI marked it failed is thrown away, and a
// scaffold that completes after the UI gave up leaves a registered project
// whose name the next attempt is refused on ("project directory already
// exists"). The backend figures are read from the Rust source at run time so
// the two sides cannot drift silently. Lives under __tests__/, which tsc skips
// (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve(null);
  }),
}));

import { webbuildScaffold, webbuildSessionSend, webbuildSketch } from '@/api/webbuild';

function rust(rel: string): string {
  const raw = readFileSync(resolve(process.cwd(), rel), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** The body of `fn name(` up to the next top-level closing brace. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`fn ${name}(`);
  expect(start, `fn ${name} not found`).toBeGreaterThanOrEqual(0);
  return src.slice(start, src.indexOf('\n}\n', start));
}

function secs(re: RegExp, text: string, what: string): number {
  const m = re.exec(text);
  expect(m, `${what} not found`).not.toBeNull();
  return Number(m![1]);
}

function timeoutOf(args: unknown[]): number {
  expect(typeof args[3], 'an explicit timeout is passed').toBe('number');
  return args[3] as number;
}

describe('webbuild IPC timeout parity', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('the sketch waits past the headless leg and its kill grace', async () => {
    // webbuild_sketch -> cli_text_tracked -> cli_text_inner: one leg, no escalation.
    const cmd = rust('src-tauri/src/commands/infrastructure/webbuild.rs');
    expect(fnBody(cmd, 'webbuild_sketch')).toMatch(/athena_reaction::cli_text_tracked\(/);
    const body = fnBody(rust('src-tauri/src/companion/athena_reaction.rs'), 'cli_text_inner');
    const leg = secs(/let timeout = std::time::Duration::from_secs\((\d+)\);/, body, 'leg timeout');
    const grace = secs(/timeout\(std::time::Duration::from_secs\((\d+)\), child\.wait\(\)\)/, body, 'kill grace');

    await webbuildSketch('a bakery');
    expect(calls[0]![0]).toBe('webbuild_sketch');
    expect(timeoutOf(calls[0]!)).toBeGreaterThan((leg + grace) * 1000);
  });

  it('the scaffold waits past SCAFFOLD_TIMEOUT plus its registration', async () => {
    const src = rust('src-tauri/src/webbuild/project.rs');
    const budget = secs(/const SCAFFOLD_TIMEOUT: Duration = Duration::from_secs\((\d+)\);/, src, 'SCAFFOLD_TIMEOUT');
    expect(fnBody(src, 'scaffold_next_app')).toMatch(/SCAFFOLD_TIMEOUT/);

    await webbuildScaffold('Hearth');
    expect(calls[0]![0]).toBe('webbuild_scaffold');
    // After bun returns the backend still writes next.config.ts and inserts the
    // project row; equal numbers leave no room for either.
    expect(timeoutOf(calls[0]!)).toBeGreaterThan(budget * 1000);
  });

  it('a build turn waits past TURN_TIMEOUT', async () => {
    const budget = secs(
      /const TURN_TIMEOUT: Duration = Duration::from_secs\((\d+) \* 60\);/,
      rust('src-tauri/src/companion/session/events.rs'),
      'TURN_TIMEOUT',
    ) * 60;

    await webbuildSessionSend('p1', 'add a menu');
    expect(calls[0]![0]).toBe('webbuild_session_send');
    expect(timeoutOf(calls[0]!)).toBeGreaterThan(budget * 1000);
  });
});
