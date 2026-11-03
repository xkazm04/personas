// @vitest-environment node
// `buildUpdateInput` omits a key to mean "leave this column alone" ONLY for the
// fields in PERSONA_NULLABLE_FIELDS; every other key is sent, and for an
// `Option<Option<T>>` field an explicit `null` means CLEAR. So the list must be
// exactly the set of `#[serde(default, deserialize_with = "double_option")]`
// fields on the Rust `UpdatePersonaInput`. The existing personas.test.ts loops
// over the list itself and cannot notice a field the list is missing; this
// test reads the Rust struct at run time so the two cannot drift silently.
// Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PERSONA_NULLABLE_FIELDS } from '../personas';

function rustDoubleOptionFields(): string[] {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/core/src/models/persona.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const start = src.indexOf('pub struct UpdatePersonaInput {');
  expect(start, 'UpdatePersonaInput not found in persona.rs').toBeGreaterThanOrEqual(0);
  const body = src.slice(start, src.indexOf('\n}', start));
  const fields = [
    ...body.matchAll(/deserialize_with\s*=\s*"double_option"\s*\)\]\s*pub\s+(\w+)\s*:\s*Option<Option</g),
  ].map((m) => m[1]!);
  expect(fields.length, 'a matcher that finds nothing is a broken matcher').toBeGreaterThan(0);
  return fields;
}

describe('PERSONA_NULLABLE_FIELDS parity with the Rust UpdatePersonaInput', () => {
  it('lists exactly the double_option fields, no more and no fewer', () => {
    expect([...PERSONA_NULLABLE_FIELDS].sort()).toEqual(rustDoubleOptionFields().sort());
  });
});
