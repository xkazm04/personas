import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODEL_OPTIONS } from '../modelOptions';

// GATE OVER THE ARTIFACT: the team studio picker holds concrete model ids that
// the backend owns as the *_CURRENT constants of personas_core::model_ids. This
// test parses those constants out of the Rust source at run time instead of
// holding a third copy (precedent: webhookPatternParity.test.ts), so a model
// bump in Rust that the picker does not follow turns this red.
const MODEL_IDS_RS = resolve(__dirname, '../../../../../../src-tauri/core/src/model_ids.rs');

const FAMILIES = ['haiku', 'sonnet', 'opus'] as const;

function currentIds(): Map<string, string> {
  const src = readFileSync(MODEL_IDS_RS, 'utf8');
  const re = /pub const (HAIKU|SONNET|OPUS)_CURRENT: &str = "([^"]+)";/g;
  return new Map(
    [...src.matchAll(re)].map((m): [string, string] => [(m[1] ?? '').toLowerCase(), m[2] ?? '']),
  );
}

describe('team studio model options <-> model_ids *_CURRENT parity', () => {
  it('finds every *_CURRENT constant it claims to gate', () => {
    // A parse that matched nothing must fail, not report clean.
    const ids = currentIds();
    for (const family of FAMILIES) expect(ids.get(family)).toMatch(/^claude-/);
  });

  it('each family option names the current id', () => {
    const ids = currentIds();
    for (const family of FAMILIES) {
      const option = MODEL_OPTIONS.find((o) => o.key === family);
      expect(option?.model, family).toBe(ids.get(family));
    }
  });
});
