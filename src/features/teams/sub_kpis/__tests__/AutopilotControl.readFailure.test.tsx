import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

// A rejected getAutopilotMode must read as unknown, not as a selected, clickable "Off".

const getAutopilotMode = vi.hoisted(() => vi.fn());
const setAutopilotMode = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/autopilot', () => ({ getAutopilotMode, setAutopilotMode }));

import { AutopilotControl } from '../AutopilotControl';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['kpis', 'shared']);
});
beforeEach(() => {
  getAutopilotMode.mockReset();
  setAutopilotMode.mockReset();
});

describe('AutopilotControl read failure', () => {
  it('selects nothing, disables the modes and offers a retry', async () => {
    getAutopilotMode.mockRejectedValueOnce({ error: 'database is locked', kind: 'database' });
    render(<AutopilotControl projectId="p1" />);
    await screen.findByRole('alert');
    for (const r of screen.getAllByRole('radio')) {
      expect(r.getAttribute('aria-checked')).toBe('false');
      expect((r as HTMLButtonElement).disabled).toBe(true);
    }
    getAutopilotMode.mockResolvedValueOnce('suggest');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('radio', { name: /suggest/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('a stored mode still renders selected', async () => {
    getAutopilotMode.mockResolvedValue('full');
    render(<AutopilotControl projectId="p1" />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /full/i }).getAttribute('aria-checked')).toBe('true'));
  });
});
