import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FRONTEND_LANE, frontendLaneOf } from '../frontendLanes';

// GATE OVER THE ARTIFACT. The lanes of a build question and a chat thread are
// decided in Rust (`UNSIGNED_LANE`, mandate_router.rs) and applied here,
// because neither kind has a row the snapshot can read. This test parses the
// Rust table at run time instead of holding a copy of it.
const ROUTER_RS = resolve(__dirname, '../../../../../src-tauri/engine/src/mandate_router.rs');

/** RouteKind name (Rust) -> the frontend DecisionKind that carries it. */
const RUST_KIND: Record<string, string> = {
  Question: 'question',
  Message: 'message',
  // lens-scan cards (spark one-control, WP3): frontend-derived, mandate keep-out.
  LensBuild: 'build',
  LensEvidence: 'evidence',
  LensRelease: 'release',
};

function rustRows(): Map<string, { lane: string; clause: string }> {
  const src = readFileSync(ROUTER_RS, 'utf8');
  const table = src.match(/pub const UNSIGNED_LANE: &\[UnsignedRow\] = &\[([\s\S]*?)\n\];/);
  if (!table) throw new Error(`No 'pub const UNSIGNED_LANE' in ${ROUTER_RS}`);
  const rows = new Map<string, { lane: string; clause: string }>();
  for (const m of table[1]!.matchAll(
    /kind:\s*RouteKind::(\w+),\s*lane:\s*Lane::(\w+),\s*clause:\s*LaneClause::(\w+)/g,
  )) {
    rows.set(m[1]!, { lane: m[2]!.toLowerCase(), clause: m[3]!.toLowerCase() });
  }
  return rows;
}

describe('frontend lanes <-> UNSIGNED_LANE parity', () => {
  it('finds the Rust table it claims to follow', () => {
    // A parse that matched nothing must not report clean.
    expect(rustRows().size).toBeGreaterThan(5);
  });

  it('routes every frontend-derived kind exactly as the Rust row says', () => {
    const rows = rustRows();
    for (const [rustKind, kind] of Object.entries(RUST_KIND)) {
      const row = rows.get(rustKind);
      expect(row, `UNSIGNED_LANE has no ${rustKind} row`).toBeDefined();
      expect(FRONTEND_LANE[kind as keyof typeof FRONTEND_LANE]).toEqual(row);
    }
  });

  it('routes nothing else on the frontend', () => {
    expect(Object.keys(FRONTEND_LANE).sort()).toEqual(['build', 'evidence', 'message', 'question', 'release']);
    expect(frontendLaneOf('review')).toBeNull();
    expect(frontendLaneOf('question')).toEqual({ lane: 'breach', clause: 'unsigned' });
    expect(frontendLaneOf('message')).toEqual({ lane: 'talk', clause: 'none' });
    expect(frontendLaneOf('build')).toEqual({ lane: 'breach', clause: 'unsigned' });
    expect(frontendLaneOf('evidence')).toEqual({ lane: 'accept', clause: 'none' });
    expect(frontendLaneOf('release')).toEqual({ lane: 'accept', clause: 'none' });
  });

  it('names each lens-scan kind on the Rust side with the frontend wire name', () => {
    // RouteKind::wire() is what the snapshot would carry as `itemKind`; the keep-out
    // rows must speak the frontend's kind names, or a future snapshot row would miss its card.
    const src = readFileSync(ROUTER_RS, 'utf8');
    for (const [rustKind, kind] of Object.entries(RUST_KIND)) {
      if (!rustKind.startsWith('Lens')) continue;
      expect(src).toMatch(new RegExp(`Self::${rustKind}\\s*=>\\s*"${kind}"`));
    }
  });
});
