import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `CycleStats` is written twice — once in Rust, once in TypeScript — and
 * nothing generates either from the other.
 *
 * It cannot be a ts-rs binding: the Rust struct is `pub(super)`, and the TS
 * mirror is deliberately wholly optional because the Rust side serialises
 * with `skip_serializing_if` and promises consumers tolerate unknown keys. A
 * generated binding would make every field required and describe a contract
 * the backend does not keep.
 *
 * So this test is the mechanism that asserts the two agree. It reads both
 * declarations as text and compares the field-name sets. A field added on
 * either side alone fails here, which is the whole point: the alternative was
 * a comment asking the next author to remember.
 */
const REPO = resolve(__dirname, '../../..');
const RUST = 'src-tauri/src/companion/brain/sleep_cycle/run.rs';
const TS = 'src/api/companion/brain.ts';

function block(source: string, start: RegExp, file: string): string {
  const match = start.exec(source);
  if (!match) throw new Error(`could not find the CycleStats declaration in ${file}`);
  const from = source.indexOf('{', match.index);
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(from + 1, i);
    }
  }
  throw new Error(`unbalanced braces reading CycleStats from ${file}`);
}

function fields(body: string, pattern: RegExp): string[] {
  return [...body.matchAll(pattern)].map((m) => m[1]).sort();
}

describe('CycleStats — the Rust struct and its TypeScript mirror', () => {
  it('declare the same field names', () => {
    const rust = readFileSync(resolve(REPO, RUST), 'utf8');
    const ts = readFileSync(resolve(REPO, TS), 'utf8');

    const rustFields = fields(
      block(rust, /pub\(super\)\s+struct\s+CycleStats\b/, RUST),
      /^\s*pub\(super\)\s+([a-z_][a-z0-9_]*)\s*:/gm
    );
    const tsFields = fields(
      block(ts, /export\s+interface\s+CycleStats\b/, TS),
      /^\s*([a-z_][a-z0-9_]*)\?\s*:/gm
    );

    expect(rustFields.length).toBeGreaterThan(0);
    expect(tsFields).toEqual(rustFields);
  });

  it('keeps every TypeScript field optional', () => {
    const ts = readFileSync(resolve(REPO, TS), 'utf8');
    const body = block(ts, /export\s+interface\s+CycleStats\b/, TS);
    const required = [...body.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]);
    // A required field would read an omitted counter as a lie rather than as
    // "this cycle did not record it".
    expect(required).toEqual([]);
  });
});
