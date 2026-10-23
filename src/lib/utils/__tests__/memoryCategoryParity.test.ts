import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_MEMORY_CATEGORIES } from '../formatters';

// The memory category vocabulary is written twice: the Rust door validator
// (`MEMORY_CATEGORIES`, which refuses any other value on create) and the TS
// union `PersonaMemoryCategory`, whose gated colour map is the enumeration
// every picker and filter is built from. The backend's own category list
// (`list_memory_categories`) has no frontend caller, so nothing tied the two.
// A category added on one side only either never appears in a picker or is
// offered and then refused by the server.

describe('memory category vocabulary', () => {
  it('matches the Rust validator exactly, in order', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src-tauri/core/src/validation/memory.rs'),
      'utf8',
    ).replace(/\/\/.*$/gm, '');
    const block = /pub const MEMORY_CATEGORIES: &\[&str\] = &\[([\s\S]*?)\];/.exec(src)?.[1];
    expect(block, 'MEMORY_CATEGORIES literal not found').toBeDefined();
    const rust = [...(block ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(rust.length).toBeGreaterThan(0);
    expect([...ALL_MEMORY_CATEGORIES]).toEqual(rust);
  });
});
