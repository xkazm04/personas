import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

  it('says loading failed (not "No agents yet") when listing agents rejects, and retries', async () => {
    listPersonas.mockRejectedValueOnce(new Error('db locked'));
    render(<ExecutePersonaPicker selectedIds={new Set()} onToggle={vi.fn()} />);
    expect(await screen.findByText(/couldn.t load your agents/i)).not.toBeNull();
    expect(screen.queryByText(/No agents yet/)).toBeNull();
    listPersonas.mockResolvedValueOnce(rows);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Alpha' })).not.toBeNull();
    expect(screen.queryByText(/couldn.t load your agents/i)).toBeNull();
  });

  it('still says "No agents yet" when the roster is genuinely empty', async () => {
    listPersonas.mockResolvedValue([]);
    render(<ExecutePersonaPicker selectedIds={new Set()} onToggle={vi.fn()} />);
    expect(await screen.findByText(/No agents yet/)).not.toBeNull();
  });

  it('says nothing matched when the filter excludes every agent', async () => {
    listPersonas.mockResolvedValue(rows);
    render(<ExecutePersonaPicker selectedIds={new Set()} onToggle={vi.fn()} />);
    await screen.findByRole('button', { name: 'Alpha' });
    fireEvent.change(screen.getByPlaceholderText(/Filter agents/), { target: { value: 'zzz' } });
    expect(screen.queryByText('No results found')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/Filter agents/), { target: { value: 'alp' } });
    expect(screen.queryByText('No results found')).toBeNull();
  });
});
