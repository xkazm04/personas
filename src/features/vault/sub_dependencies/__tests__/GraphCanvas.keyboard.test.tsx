import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GraphNode } from '../credentialGraph';
import { GraphCanvas } from '../GraphCanvas';

/**
 * Selecting a node is the only way into a credential's blast radius and the
 * revocation simulator. The nodes were mouse-only SVG groups: no tab stop, no
 * role, no name, so a keyboard user could not open either panel at all.
 */
const nodes: GraphNode[] = [
  { id: 'cred-1', kind: 'credential', label: 'Stripe key', color: '#8b5cf6', meta: { healthOk: true } },
  { id: 'agent:p1', kind: 'agent', label: 'Billing bot', color: '#3b82f6', meta: {} },
];

describe('GraphCanvas nodes', () => {
  it('are named keyboard stops that select on Enter and Space', () => {
    const onNodeClick = vi.fn();
    render(
      <GraphCanvas
        nodes={nodes}
        edges={[{ id: 'e1', source: 'cred-1', target: 'agent:p1', style: 'solid' }]}
        counts={{ credential: 1, agent: 1, event: 0 }}
        filterKind="all"
        selectedNodeId={null}
        onNodeClick={onNodeClick}
        detailPanel={null}
      />,
    );

    const cred = screen.getByRole('button', { name: 'Stripe key' });
    expect(cred.getAttribute('tabindex')).toBe('0');

    fireEvent.keyDown(cred, { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Billing bot' }), { key: ' ' });
    expect(onNodeClick.mock.calls).toEqual([['cred-1'], ['agent:p1']]);
  });
});
