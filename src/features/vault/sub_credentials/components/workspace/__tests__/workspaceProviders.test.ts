import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GOOGLE_WORKSPACE } from '../workspaceProviders';

/**
 * Workspace Connect creates one credential per selected service with
 * `service_type = svc.serviceType`. Every lookup downstream (connector
 * definition, healthcheck, persona connector matching, OAuth refresh) keys on
 * that string equalling a seeded connector's `name`. Gmail shipped as
 * `google_gmail` while the seed is `gmail`, so a Workspace-made Gmail
 * credential matched no connector at all.
 */
const SEED_DIR = join(process.cwd(), 'scripts/connectors/builtin');

function seededConnectorNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(SEED_DIR)) {
    if (!file.endsWith('.json')) continue;
    const parsed: unknown = JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8'));
    if (parsed && typeof parsed === 'object' && 'name' in parsed && typeof parsed.name === 'string') {
      names.add(parsed.name);
    }
  }
  return names;
}

describe('GOOGLE_WORKSPACE services', () => {
  const names = seededConnectorNames();

  it('reads a non-trivial seed catalog', () => {
    expect(names.size).toBeGreaterThan(50);
  });

  it.each(GOOGLE_WORKSPACE.services.map((s) => [s.serviceType]))(
    'service type %s is a seeded connector name',
    (serviceType) => {
      expect(names.has(serviceType)).toBe(true);
    },
  );
});
