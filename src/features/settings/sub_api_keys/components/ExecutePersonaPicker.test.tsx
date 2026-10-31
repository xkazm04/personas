import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const listPersonas = vi.fn();
vi.mock('@/api/agents/personas', () => ({ listPersonas: () => listPersonas() }));

import { ExecutePersonaPicker } from './ExecutePersonaPicker';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const rows = [
  { id: 'a1', name: 'Alpha' },
  { id: 'b2', name: 'Beta' },
];

describe('ExecutePersonaPicker', () => {
  beforeEach(() => {
    listPersonas.mockReset();
  });

  it('exposes each agent as one pressed-state toggle, not a nested checkbox', async () => {
    listPersonas.mockResolvedValue(rows);
    render(<ExecutePersonaPicker selectedIds={new Set(['a1'])} onToggle={vi.fn()} />);
    const alpha = await screen.findByRole('button', { name: 'Alpha' });
    const beta = screen.getByRole('button', { name: 'Beta' });
    expect(alpha.getAttribute('aria-pressed')).toBe('true');
    expect(beta.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
