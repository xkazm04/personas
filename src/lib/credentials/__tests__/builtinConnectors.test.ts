import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
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
      join(process.cwd(), 'src-tauri/src/db/builtin_connectors.rs'),
      'utf8',
    );
    expect(src).toContain('r##"personas_messages"##');
  });

  it('CONN-02 (existing install): both seed paths in db/mod.rs are idempotent — no new migration required', () => {
    const src = readFileSync(
      join(process.cwd(), 'src-tauri/src/db/mod.rs'),
      'utf8',
    );
    // seed_builtin_connectors uses INSERT OR IGNORE on connector_definitions
    expect(src).toContain('INSERT OR IGNORE INTO connector_definitions');
    // seed_builtin_credentials guards with an existence check on persona_credentials
    expect(src).toMatch(/SELECT COUNT\(\*\) > 0 FROM persona_credentials WHERE id/);
  });
});
