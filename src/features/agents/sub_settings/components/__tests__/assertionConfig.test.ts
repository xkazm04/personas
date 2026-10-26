// @vitest-environment node
// The settings section writes an assertion's `config` as a JSON string the
// engine deserializes on every run (src-tauri/engine/src/output_assertions.rs).
// The create command stores the string unparsed, so a key the engine does not
// read only fails later: on every run, as a failed assertion that fires its
// on-failure action. The Rust struct fields are read from source at run time
// so the TS writer and the engine reader cannot drift. Lives under __tests__/,
// which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assertionConfigJson, parsePhrases } from '../assertionConfig';

function engineSource(): string {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/engine/src/output_assertions.rs'), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Field names of a `struct Name { ... }`, and which of them have no serde default. */
function structFields(src: string, name: string): { all: string[]; required: string[] } {
  const start = src.indexOf(`struct ${name} {`);
  expect(start, `struct ${name} not found`).toBeGreaterThanOrEqual(0);
  const body = src.slice(src.indexOf('{', start) + 1, src.indexOf('\n}', start));
  const all: string[] = [];
  const required: string[] = [];
  let defaulted = false;
  for (const line of body.split('\n').map((l) => l.trim())) {
    if (line.startsWith('#[serde(default')) {
      defaulted = true;
      continue;
    }
    const m = /^([a-z_]+):/.exec(line);
    if (!m) continue;
    all.push(m[1]!);
    if (!defaulted) required.push(m[1]!);
    defaulted = false;
  }
  return { all, required };
}

describe('assertionConfigJson matches the engine config structs', () => {
  const src = engineSource();

  it.each([
    ['contains', 'ContainsConfig'],
    ['not_contains', 'NotContainsConfig'],
  ] as const)('%s writes only keys %s reads, and every required one', (type, struct) => {
    const fields = structFields(src, struct);
    const written = Object.keys(JSON.parse(assertionConfigJson(type, ['alpha', 'beta'])) as object);
    for (const key of written) expect(fields.all).toContain(key);
    for (const key of fields.required) expect(written).toContain(key);
  });

  it('carries the phrases under the list key the engine iterates', () => {
    expect(JSON.parse(assertionConfigJson('contains', ['a', 'b']))).toMatchObject({ phrases: ['a', 'b'] });
    expect(JSON.parse(assertionConfigJson('not_contains', ['a', 'b']))).toMatchObject({ patterns: ['a', 'b'] });
  });
});

describe('parsePhrases', () => {
  it('splits on commas and drops blanks', () => {
    expect(parsePhrases(' a, ,b ,')).toEqual(['a', 'b']);
  });
});
