/**
 * Routing and compliance rule cards: the per-rule enable toggle and delete
 * control are icon-only, so their accessible name is the only thing a screen
 * reader or a test can address them by. Each must name the rule it acts on.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ByomRoutingRules } from '../ByomRoutingRules';
import { ByomComplianceRules } from '../ByomComplianceRules';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

describe('BYOM rule card controls', () => {
  it('names the routing rule toggle and delete control after the rule', () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(
      <ByomRoutingRules
        rules={[{ name: 'Cheap first', task_complexity: 'simple', provider: 'claude_code', model: null, enabled: true }]}
        warnings={new Map()}
        onAdd={() => {}}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Disable Cheap first', pressed: true });
    fireEvent.click(toggle);
    expect(onUpdate).toHaveBeenCalledWith(0, { enabled: false });
    fireEvent.click(screen.getByRole('button', { name: /Delete.*Cheap first/ }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it('names the compliance rule toggle and delete control after the rule', () => {
    render(
      <ByomComplianceRules
        rules={[{ name: 'EU only', workflow_tags: [], allowed_providers: ['claude_code'], enabled: false }]}
        warnings={new Map()}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Enable EU only', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete.*EU only/ })).toBeInTheDocument();
  });
});
