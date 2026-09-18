/**
 * ByomAuditLog — the provider audit trail.
 *
 * The three cases here are the ones the table could not answer before it grew
 * the rule columns: which routing rule picked the provider, which compliance
 * rule admitted it, and what the log says when neither was recorded. The last
 * one is the load-bearing case: a null rule name must not be rendered as a
 * word, because "default" is a claim the audit writer never made.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProviderAuditEntry } from '@/lib/bindings/ProviderAuditEntry';
import { ByomAuditLog } from '../ByomAuditLog';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

function entry(over: Partial<ProviderAuditEntry> = {}): ProviderAuditEntry {
  return {
    id: 'a1',
    execution_id: 'e1',
    persona_id: 'p1',
    persona_name: 'Dev Clone',
    engine_kind: 'claude',
    model_used: 'claude-opus-5',
    was_failover: false,
    routing_rule_name: null,
    compliance_rule_name: null,
    cost_usd: 0.12,
    duration_ms: 4000n,
    status: 'completed',
    created_at: '2026-09-17T10:00:00Z',
    ...over,
  } as ProviderAuditEntry;
}

describe('ByomAuditLog rule columns', () => {
  it('names the routing rule that picked the provider', () => {
    render(<ByomAuditLog auditLog={[entry({ routing_rule_name: 'Cheap first' })]} />);
    expect(screen.getByTestId('byom-audit-routing-rule')).toHaveTextContent('Cheap first');
  });

  it('names the compliance rule that admitted it', () => {
    render(<ByomAuditLog auditLog={[entry({ compliance_rule_name: 'EU only' })]} />);
    expect(screen.getByTestId('byom-audit-compliance-rule')).toHaveTextContent('EU only');
  });

  it('marks an unrecorded rule rather than inventing "default"', () => {
    render(<ByomAuditLog auditLog={[entry()]} />);
    const routing = screen.getByTestId('byom-audit-routing-rule');
    const compliance = screen.getByTestId('byom-audit-compliance-rule');
    expect(routing).toHaveTextContent('-');
    expect(compliance).toHaveTextContent('-');
    expect(routing.textContent?.toLowerCase()).not.toContain('default');
    expect(compliance.textContent?.toLowerCase()).not.toContain('default');
  });

  it('treats an empty rule name as unrecorded, not as a nameless rule', () => {
    render(<ByomAuditLog auditLog={[entry({ routing_rule_name: '  ' })]} />);
    expect(screen.getByTestId('byom-audit-routing-rule')).toHaveTextContent('-');
  });
});
