import { describe, it, expect, beforeEach, vi } from 'vitest';

import { applicableDeployActions } from '@/features/teams/sub_factory/passport/improve/deployActions';
import { applicableStandardsActions } from '@/features/teams/sub_factory/passport/improve/standards';
import { connectorSpecFor } from '@/features/teams/sub_factory/passport/improve/connectors';
import type { ImproveRaw } from '@/features/teams/sub_factory/passport/improve/ImproveContext';

import { dimAction } from '../lib/dimActions';
import { DIM_ORDER, DIM_REGISTRY } from '../lib/dimRegistry';
import { makePassport } from './passportFactory';

// dimActions owns only the branching; its collaborators (the wall's
// applicability checks) are mocked so each branch is pinned in isolation.
vi.mock('@/features/teams/sub_factory/passport/improve/deployActions', () => ({
  applicableDeployActions: vi.fn(() => []),
}));
vi.mock('@/features/teams/sub_factory/passport/improve/standards', () => ({
  applicableStandardsActions: vi.fn(() => []),
}));
vi.mock('@/features/teams/sub_factory/passport/improve/connectors', () => ({
  connectorSpecFor: vi.fn(() => null),
}));

const mockDeploy = vi.mocked(applicableDeployActions);
const mockStandards = vi.mocked(applicableStandardsActions);
const mockConnector = vi.mocked(connectorSpecFor);

const passport = makePassport();
const raw = (standardsConfig: string | null = null, skillsToAdd: ImproveRaw['skillsToAdd'] = []) =>
  ({ project: { standards_config: standardsConfig }, skillsToAdd }) as unknown as ImproveRaw;

describe('dimActions — dim → wall-row mapping (via the dimension registry)', () => {
  it('maps every canvas dim to its wall row (snapshot)', () => {
    const mapping = Object.fromEntries(DIM_ORDER.map((k) => [k, DIM_REGISTRY[k].rowKey]));
    expect(mapping).toEqual({
      db: 'migrations',
      monitoring: 'observability',
      ci: 'ci',
      tests: 'tests',
      security: 'security',
      hosting: 'hosting',
      auth: null,
      agents: 'aiflow',
      skills: 'skills',
      llm: 'llmtracking',
      kpi: null,
      ideas: null,
    });
  });
});

describe('dimActions — dimAction applicability', () => {
  beforeEach(() => {
    mockDeploy.mockReturnValue([]);
    mockStandards.mockReturnValue([]);
    mockConnector.mockReturnValue(null);
  });

  it('ideas is actionable with a passport, inert without', () => {
    expect(dimAction('ideas', passport, undefined)).toEqual({ rowKey: null, action: 'ideas' });
    expect(dimAction('ideas', undefined, undefined)).toEqual({ rowKey: null, action: null });
  });

  it('null-row dims (auth, kpi) are always inert', () => {
    expect(dimAction('auth', passport, raw())).toEqual({ rowKey: null, action: null });
    expect(dimAction('kpi', passport, raw())).toEqual({ rowKey: null, action: null });
  });

  it('a real row without a passport is inert but still reports its rowKey', () => {
    expect(dimAction('db', undefined, undefined)).toEqual({ rowKey: 'migrations', action: null });
  });

  it('ci → standards when standards actions apply, else inert', () => {
    mockStandards.mockReturnValue([{} as never]);
    expect(dimAction('ci', passport, raw('{"foo":1}')).action).toBe('standards');
    mockStandards.mockReturnValue([]);
    expect(dimAction('ci', passport, raw('{"foo":1}')).action).toBeNull();
    // No raw → the standards check can't run → inert.
    expect(dimAction('ci', passport, undefined).action).toBeNull();
  });

  it('a deploy-capable row → deploy', () => {
    mockDeploy.mockReturnValue([{} as never]);
    expect(dimAction('db', passport, raw()).action).toBe('deploy');
  });

  it('a connector-backed row → deploy', () => {
    mockConnector.mockReturnValue({ applicable: () => true } as never);
    expect(dimAction('monitoring', passport, raw()).action).toBe('deploy');
  });

  it('skills with pending installs → deploy', () => {
    expect(dimAction('skills', passport, raw(null, [{ name: 'x', source: null, description: null }])).action).toBe('deploy');
  });

  it('a real row with no applicable action is inert', () => {
    expect(dimAction('security', passport, raw()).action).toBeNull();
  });
});
