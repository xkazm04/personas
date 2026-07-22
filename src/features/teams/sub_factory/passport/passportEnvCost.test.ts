import { describe, it, expect } from 'vitest';
import type { CrossProjectProjectMetadata, RepoEvidence } from '@/api/devTools/devTools';
import type { DevProject } from '@/lib/bindings/DevProject';
import { derivePassportFromMetadata, parseAppCost } from './passportDerive';
import { SECTIONS, cellSortValue, type CellValue } from './passportRows';

function mkMeta(over: Partial<CrossProjectProjectMetadata> = {}): CrossProjectProjectMetadata {
  return {
    project_id: 'p1', name: 'Proj', summary: '', keywords: [], api_surface: [],
    tech_layers: ['typescript', 'rust-backend', 'database'], db_tables: ['t'],
    context_count: 0, group_count: 0, active_goal_count: 0,
    ...over,
  } as CrossProjectProjectMetadata;
}

function mkProject(over: Partial<DevProject> = {}): DevProject {
  return {
    id: 'p1', name: 'Proj', root_path: 'C:/x', description: null, status: 'active',
    tech_stack: 'react', github_url: null, monitoring_credential_id: null,
    pr_credential_id: null, llm_tracking_credential_id: null, test_env_url: null,
    standards_config: null, auto_pr_on_success: false, team_id: null,
    ...over,
  } as DevProject;
}

function mkEv(over: Partial<RepoEvidence> = {}): RepoEvidence {
  return { scanned: true, package_scripts: [], ci_workflows: [], ...over } as RepoEvidence;
}

const rowGet = (key: string) => {
  const row = SECTIONS.flatMap((s) => s.rows).find((r) => r.key === key);
  if (!row) throw new Error(`row ${key} not found`);
  return row.get;
};

describe('parseAppCost', () => {
  it('returns null when the file is absent (raw null/undefined)', () => {
    expect(parseAppCost(null)).toBeNull();
    expect(parseAppCost(undefined)).toBeNull();
  });

  it('flags invalid JSON as present-but-unreadable instead of throwing', () => {
    const c = parseAppCost('{nope');
    expect(c).toEqual({ currency: 'USD', services: [], parseError: true });
  });

  it('parses services leniently — bad monthly values become null (unpriced)', () => {
    const c = parseAppCost(JSON.stringify({
      currency: 'EUR',
      services: [
        { name: 'Vercel', monthly: 20, note: 'hosting' },
        { name: 'Sentry', monthly: 'lots' },
        { monthly: 5 },
        'garbage',
      ],
    }));
    expect(c?.currency).toBe('EUR');
    expect(c?.services).toEqual([
      { name: 'Vercel', monthly: 20, note: 'hosting' },
      { name: 'Sentry', monthly: null, note: undefined },
      { name: 'unnamed', monthly: 5, note: undefined },
    ]);
  });
});

describe('environment slots (derive)', () => {
  it('fills only observed slots and leaves the rest as honest nulls', () => {
    const ev = mkEv({ package_scripts: ['dev', 'build'] });
    const p = derivePassportFromMetadata(
      mkMeta(),
      mkProject({ monitoring_credential_id: 'cred', test_env_url: 'https://app-test.fly.dev/health' }),
      { evidence: ev },
    );
    const env = p.stack.environments!;
    expect(env.db.local.label).toBe('SQLite'); // rust-backend + database layers
    expect(env.db.test.label).toBeNull();
    expect(env.db.production.label).toBeNull();
    expect(env.monitoring.production.label).toBe('connected');
    expect(env.monitoring.local.label).toBeNull();
    expect(env.hosting.local.label).toBe('dev script');
    expect(env.hosting.test.label).toBe('app-test.fly.dev');
    expect(env.hosting.production.label).toBeNull();
  });

  it('renders all-empty env slots when nothing is configured', () => {
    const p = derivePassportFromMetadata(mkMeta({ tech_layers: [], db_tables: [] }), mkProject());
    const cell = rowGet('hosting')(p) as Extract<CellValue, { kind: 'env' }>;
    expect(cell.kind).toBe('env');
    expect(cell.slots.map((s) => s.env)).toEqual(['local', 'test', 'production']);
    expect(cell.slots.every((s) => s.label === null)).toBe(true);
    expect(cellSortValue(cell)).toBe(0);
  });
});

describe('app cost row', () => {
  it('is NA (missing) when no evidence / no file', () => {
    const p = derivePassportFromMetadata(mkMeta(), mkProject());
    expect(rowGet('appcost')(p)).toEqual({ kind: 'cost', state: 'missing' });
  });

  it('invites manual fill when the file exists but is empty', () => {
    const ev = mkEv({ app_cost_raw: '{"currency":"USD","services":[]}' });
    const p = derivePassportFromMetadata(mkMeta(), mkProject(), { evidence: ev });
    expect(rowGet('appcost')(p)).toMatchObject({ kind: 'cost', state: 'empty' });
  });

  it('totals priced services and keeps unpriced ones visible', () => {
    const raw = JSON.stringify({ currency: 'USD', services: [
      { name: 'Vercel', monthly: 20 }, { name: 'Neon', monthly: 19 }, { name: 'Sentry' },
    ] });
    const ev = mkEv({ app_cost_raw: raw });
    const p = derivePassportFromMetadata(mkMeta(), mkProject(), { evidence: ev });
    const cell = rowGet('appcost')(p) as Extract<CellValue, { kind: 'cost' }>;
    expect(cell.state).toBe('known');
    expect(cell.total).toBe(39);
    expect(cell.services).toHaveLength(3);
    expect(cellSortValue(cell)).toBe(100);
  });
});
