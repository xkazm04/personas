import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { commandProblem, SERVER_COMMAND_MAX } from '../serverConfig';

// GATE OVER THE ARTIFACT: `serverConfig.ts` mirrors the dev-command validator
// (`validate_command` in src-tauri/src/webbuild/server_control.rs). The Edit
// modal's inline verdict is only honest while the two agree, so this test reads
// the Rust constants at run time instead of holding a hand-copy of them
// (precedent: webhookPatternParity.test.ts). A character added to Rust's
// FORBIDDEN_CHARS, or a changed COMMAND_MAX_CHARS, turns this red.
const SERVER_CONTROL_RS = resolve(__dirname, '../../../../../src-tauri/src/webbuild/server_control.rs');

function rustSource(): string {
  return readFileSync(SERVER_CONTROL_RS, 'utf8');
}

/** The chars of `const FORBIDDEN_CHARS: &[char] = &[...]`, escapes decoded. */
function rustForbiddenChars(): string[] {
  const list = /const FORBIDDEN_CHARS: &\[char\] = &\[([^\]]*)\];/.exec(rustSource())?.[1] ?? '';
  return [...list.matchAll(/'(\\.|[^'])'/g)].map((m) => {
    const lit = m[1] ?? '';
    if (lit === '\\n') return '\n';
    if (lit === '\\r') return '\r';
    if (lit === '\\t') return '\t';
    return lit.startsWith('\\') ? lit.slice(1) : lit;
  });
}

describe('dev command validator: TS mirror <-> Rust validate_command parity', () => {
  it('finds the Rust rules it claims to gate', () => {
    // A parse that matched nothing must fail, not report clean.
    expect(rustForbiddenChars().length).toBeGreaterThanOrEqual(10);
    expect(/pub const COMMAND_MAX_CHARS: usize = (\d+);/.test(rustSource())).toBe(true);
  });

  it('refuses every character Rust refuses', () => {
    const accepted = rustForbiddenChars().filter((c) => commandProblem(`npm run dev ${c} x`) !== 'forbidden');
    expect(accepted).toEqual([]);
  });

  it('refuses nothing in a plain command that Rust accepts', () => {
    expect(commandProblem('npm run dev -- --port {port}')).toBeNull();
  });

  it('uses the same length limit', () => {
    const max = Number(/pub const COMMAND_MAX_CHARS: usize = (\d+);/.exec(rustSource())?.[1]);
    expect(SERVER_COMMAND_MAX).toBe(max);
  });
});
