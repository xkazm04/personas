// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CAPABILITY_INFO } from '@/api/system/desktop';

/**
 * `CAPABILITY_INFO.risk` is what the capability-approval card shows before a
 * user grants a desktop connector a capability. It is a hand copy of
 * `DesktopCapability::risk_level()` in the engine crate. This reads the Rust
 * match (comments stripped) instead of a second literal list, so a capability
 * re-rated on either side turns this red.
 */
function rustSource(rel: string): string {
  return readFileSync(resolve(__dirname, '../../..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** `FileRead` -> `file_read`, the serde snake_case wire name. */
function snake(variant: string): string {
  return variant.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function rustRiskLevels(): Record<string, string> {
  const src = rustSource('src-tauri/engine/src/desktop_security.rs');
  const start = src.indexOf('pub fn risk_level(&self)');
  if (start < 0) throw new Error('DesktopCapability::risk_level not found; update this pin');
  const body = src.slice(start, src.indexOf('\n    }\n', start));
  const out: Record<string, string> = {};
  for (const arm of body.matchAll(/((?:Self::\w+\s*\|?\s*)+)=>\s*"(\w+)"/g)) {
    for (const v of arm[1]!.matchAll(/Self::(\w+)/g)) out[snake(v[1]!)] = arm[2]!;
  }
  return out;
}

describe('desktop capability risk: the UI table agrees with the engine', () => {
  const rust = rustRiskLevels();

  it('reads every Rust arm (not a vacuous pin)', () => {
    expect(Object.keys(rust).length).toBeGreaterThanOrEqual(8);
  });

  it('rates every capability exactly as DesktopCapability::risk_level does', () => {
    const ui = Object.fromEntries(Object.entries(CAPABILITY_INFO).map(([k, v]) => [k, v.risk]));
    expect(ui).toEqual(rust);
  });
});
