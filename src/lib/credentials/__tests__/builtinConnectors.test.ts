// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILTIN_CONNECTORS,
  connectorCategoryTags,
  connectorsInCategory,
} from '@/lib/credentials/builtinConnectors';

describe('builtinConnectors — personas_messages (CONN-01..CONN-03 regression)', () => {
  it('CONN-03: connectorCategoryTags("personas_messages") includes messaging + notifications', () => {
    const tags = connectorCategoryTags('personas_messages');
    expect(tags).toContain('messaging');
    expect(tags).toContain('notifications');
  });

  it('CONN-03: connectorsInCategory("messaging") includes personas_messages', () => {
    const names = connectorsInCategory('messaging').map((c) => c.name);
    expect(names).toContain('personas_messages');
  });

  it('CONN-01: local-messaging.json has the locked shape (id, name, category, categories, fields:[])', () => {
    const raw = readFileSync(
      join(process.cwd(), 'scripts/connectors/builtin/local-messaging.json'),
      'utf8',
    );
    const json = JSON.parse(raw) as {
      id: string;
      name: string;
      category: string;
      categories: string[];
      fields: unknown[];
    };
    expect(json.id).toBe('builtin-local-messaging');
    expect(json.name).toBe('personas_messages');
    expect(json.category).toBe('messaging');
    expect(Array.isArray(json.categories)).toBe(true);
    expect(json.categories).toContain('messaging');
    expect(json.categories).toContain('notifications');
    expect(Array.isArray(json.fields)).toBe(true);
    expect(json.fields.length).toBe(0);
  });

  it('CONN-02 (fresh install): builtin_connectors.rs contains the personas_messages entry', () => {
    const src = readFileSync(
      join(process.cwd(), 'src-tauri/db/src/builtin_connectors.rs'),
      'utf8',
    );
    expect(src).toContain('r##"personas_messages"##');
  });

  it('CONN-02 (existing install): both seed paths in the db crate root are idempotent — no new migration required', () => {
    // The data layer became its own crate on 2026-07-27, so `db/mod.rs` is now
    // `personas-db`'s `lib.rs`.
    const src = readFileSync(
      join(process.cwd(), 'src-tauri/db/src/lib.rs'),
      'utf8',
    );
    // seed_builtin_connectors uses INSERT OR IGNORE on connector_definitions
    expect(src).toContain('INSERT OR IGNORE INTO connector_definitions');
    // seed_builtin_credentials guards with an existence check on persona_credentials
    expect(src).toMatch(/SELECT COUNT\(\*\) > 0 FROM persona_credentials WHERE id/);
  });
});

describe('builtinConnectors — the TS catalog is every seed the Rust side ships', () => {
  const dir = join(process.cwd(), 'scripts/connectors/builtin');
  const seeds = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, json: JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown> }));

  it('finds the seed directory at all (an empty census is a broken census)', () => {
    expect(seeds.length).toBeGreaterThanOrEqual(100);
  });

  it('carries exactly the seeded connector names', () => {
    const seeded = seeds.map((s) => s.json.name as string).sort();
    const catalog = BUILTIN_CONNECTORS.map((c) => c.name).sort();
    expect(catalog).toEqual(seeded);
  });

  it.each(seeds.map((s) => [s.file, s.json] as const))('%s has the required connector keys', (_file, json) => {
    for (const k of ['id', 'name', 'label', 'color', 'category']) expect(typeof json[k]).toBe('string');
    expect(Array.isArray(json.fields)).toBe(true);
  });

  it('defaults the optional collections a seed omits', () => {
    for (const c of BUILTIN_CONNECTORS) {
      expect(Array.isArray(c.services)).toBe(true);
      expect(Array.isArray(c.events)).toBe(true);
      expect(c.healthcheck_config === null || typeof c.healthcheck_config === 'object').toBe(true);
    }
  });
});
