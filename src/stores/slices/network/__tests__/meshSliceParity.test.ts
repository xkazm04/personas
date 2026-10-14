// The Monitor's client-side stale bound is the backend's: `meshSlice`'s
// MESH_SNAPSHOT_STALE_MS against `SNAPSHOT_STALE_AFTER_MS` in
// core/src/models/device_mesh.rs, read at run time so the two cannot drift
// silently (client-rule-mirroring). Lives under __tests__/, which tsc skips,
// like every other test that reads the tree through node:fs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MESH_SNAPSHOT_STALE_MS } from '../meshSlice';

describe('meshSlice parity with the backend', () => {
  it('the stale bound is the Rust SNAPSHOT_STALE_AFTER_MS', () => {
    // vitest runs from the repo root (jsdom gives import.meta.url an http scheme).
    const rust = readFileSync(resolve(process.cwd(), 'src-tauri/core/src/models/device_mesh.rs'), 'utf8');
    const m = /pub const SNAPSHOT_STALE_AFTER_MS:\s*f64\s*=\s*([\d_]+)(?:\.0)?\s*;/.exec(rust);
    expect(m, 'SNAPSHOT_STALE_AFTER_MS not found in device_mesh.rs').not.toBeNull();
    expect(Number(m![1]!.replace(/_/g, ''))).toBe(MESH_SNAPSHOT_STALE_MS);
  });
});
