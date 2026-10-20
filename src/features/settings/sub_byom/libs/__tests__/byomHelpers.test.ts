import { describe, it, expect } from 'vitest';
import type { ByomPolicy } from '@/api/system/byom';
import { validateByomPolicy } from '../byomHelpers';

function policy(workflowTags: string[], enabled = true): ByomPolicy {
  return {
    enabled: true,
    allowed_providers: [],
    blocked_providers: [],
    routing_rules: [],
    compliance_rules: [
      { name: 'HIPAA', workflow_tags: workflowTags, allowed_providers: ['claude_code'], enabled },
    ],
  } as ByomPolicy;
}

describe('validateByomPolicy compliance coverage warning', () => {
  it('warns that a tagged compliance rule fails open for uncategorised personas', () => {
    const w = validateByomPolicy(policy(['hipaa'])).filter((x) => x.ruleType === 'compliance');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: 'warning', ruleIndex: 0 });
    expect(w[0]!.message).toContain('fails open');
    expect(w[0]!.message).toContain('HIPAA');
  });

  it('stays quiet for a rule without workflow tags or a disabled rule', () => {
    expect(validateByomPolicy(policy([]))).toHaveLength(0);
    expect(validateByomPolicy(policy(['hipaa'], false))).toHaveLength(0);
  });
});
