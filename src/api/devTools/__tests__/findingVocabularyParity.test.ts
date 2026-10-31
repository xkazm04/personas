// @vitest-environment node
// `FINDING_ORIGINS` and `VERIFY_STATES` in src/api/devTools/devTools.ts are
// hand-written mirrors of the Rust allowlists in
// src-tauri/core/src/models/dev_tools.rs. The Rust side validates every write
// against its list, so an origin or verify state that exists on one side only
// is either rejected by the backend or never offered by the triage UI. This
// test reads the Rust consts (comments stripped) instead of keeping a third
// copy. Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FINDING_ORIGINS, VERIFY_STATES } from '@/api/devTools/devTools';

function rustStrArray(name: string): string[] {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/core/src/models/dev_tools.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m = new RegExp(`pub const ${name}: \\[&str; (\\d+)\\] = \\[([\\s\\S]*?)\\];`).exec(src);
  expect(m, `${name} not found in dev_tools.rs`).not.toBeNull();
  const items = [...m![2]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  expect(items.length, `${name} declared length`).toBe(Number(m![1]));
  return items;
}

describe('finding vocabulary mirrors the Rust allowlists', () => {
  it('FINDING_ORIGINS matches models::FINDING_ORIGINS', () => {
    expect([...FINDING_ORIGINS]).toEqual(rustStrArray('FINDING_ORIGINS'));
  });

  it('VERIFY_STATES matches models::VERIFY_STATES', () => {
    expect([...VERIFY_STATES]).toEqual(rustStrArray('VERIFY_STATES'));
  });
});
