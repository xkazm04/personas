// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { ByomPolicy } from '@/api/system/byom';
import { validateByomPolicy as validate, type PolicyWarningDescriber } from '../byomHelpers';

// The wording is the caller's catalog lookup; here each finding describes itself by code and params.
const describe_: PolicyWarningDescriber = (code, params) => `${code}:${Object.values(params).join('|')}`;
const validateByomPolicy = (p: ByomPolicy) => validate(p, describe_);

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
    expect(w[0]).toMatchObject({ code: 'compliance_fails_open', message: 'compliance_fails_open:HIPAA' });
  });

  it('stays quiet for a rule without workflow tags or a disabled rule', () => {
    expect(validateByomPolicy(policy([]))).toHaveLength(0);
    expect(validateByomPolicy(policy(['hipaa'], false))).toHaveLength(0);
  });
});

describe('validateByomPolicy provider findings', () => {
  const blocked = (): ByomPolicy => ({
    enabled: true,
    allowed_providers: [],
    blocked_providers: ['claude_code'],
    routing_rules: [{ name: 'r', task_complexity: 'simple', provider: 'claude_code', model: null, enabled: true }],
    compliance_rules: [{ name: 'c', workflow_tags: [], allowed_providers: ['claude_code'], enabled: true }],
  }) as ByomPolicy;

  it('names the provider a finding is about, so a chip never depends on the message wording', () => {
    const w = validateByomPolicy(blocked());
    expect(w.find((x) => x.code === 'compliance_allows_blocked')?.provider).toBe('claude_code');
    expect(w.find((x) => x.code === 'routing_targets_blocked')?.provider).toBe('claude_code');
  });

  it('passes the provider label (not the id) to the describer', () => {
    const w = validateByomPolicy(blocked());
    expect(w.find((x) => x.code === 'routing_targets_blocked')?.message).toBe('routing_targets_blocked:Claude Code');
  });
});
