import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// `TauriErrorKind` is a hand-written copy of the `kind` strings the Rust
// `AppError` serializer writes (src-tauri/core/src/error.rs). Nothing
// generated it and nothing compared the two (21 = 21 on 2026-10-19), so a new
// Rust variant would reach the frontend as a kind the union says cannot exist.
// This pins the two sets.

const root = resolve(__dirname, '../../../..');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function tsKinds(): string[] {
  const src = stripComments(readFileSync(resolve(root, 'src/lib/types/tauriError.ts'), 'utf8'));
  const m = src.match(/export type TauriErrorKind\s*=([^;]+);/);
  if (!m) throw new Error('TauriErrorKind union not found');
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort();
}

function rustKinds(): string[] {
  const src = stripComments(readFileSync(resolve(root, 'src-tauri/core/src/error.rs'), 'utf8'));
  const at = src.indexOf('"kind",');
  if (at < 0) throw new Error('kind field not found in AppError serializer');
  const end = src.indexOf(')?;', at);
  const block = src.slice(at, end);
  return [...block.matchAll(/AppError::\w+(?:\s*\{\s*\.\.\s*\}|\(_\))\s*=>\s*"([a-z_]+)"/g)].map((x) => x[1]!).sort();
}

describe('TauriErrorKind equals the Rust AppError kind strings', () => {
  it('finds the Rust arms (a parser that reads nothing proves nothing)', () => {
    expect(rustKinds().length).toBeGreaterThanOrEqual(20);
  });

  it('carries exactly the kinds the backend serializes', () => {
    expect(tsKinds()).toEqual(rustKinds());
  });
});
