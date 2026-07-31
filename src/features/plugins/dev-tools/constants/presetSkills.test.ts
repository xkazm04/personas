import { describe, it, expect } from 'vitest';
import { SCAN_AGENTS } from './scanAgents';
import { SCAN_MATCH_RULES, matchAgentsToContext } from './presetSkills';
import type { DevContext } from '@/lib/bindings/DevContext';

function makeContext(overrides: Partial<DevContext>): DevContext {
  return {
    id: 'ctx-1',
    project_id: 'proj-1',
    group_id: null,
    name: 'Test context',
    description: null,
    file_paths: '[]',
    entry_points: null,
    db_tables: null,
    keywords: '[]',
    api_surface: '[]',
    cross_refs: null,
    tech_stack: '[]',
    category: null,
    business_feature: null,
    pinned: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('SCAN_MATCH_RULES — vocabulary parity with SCAN_AGENTS', () => {
  it('regression: has exactly one rule per scan agent (bounty-hunter + business-strategist previously had none)', () => {
    const agentKeys = new Set(SCAN_AGENTS.map((a) => a.key));
    const ruleKeys = new Set(SCAN_MATCH_RULES.map((r) => r.agentKey));
    expect(ruleKeys).toEqual(agentKeys);
  });

  it('regression: bounty-hunter is selectable via matchAgentsToContext', () => {
    const ctx = makeContext({ description: 'Checks for exploit and race condition bugs' });
    expect(matchAgentsToContext(ctx)).toContain('bounty-hunter');
  });

  it('regression: business-strategist is selectable via matchAgentsToContext', () => {
    const ctx = makeContext({ description: 'Improve monetization and conversion for the business' });
    expect(matchAgentsToContext(ctx)).toContain('business-strategist');
  });
});
