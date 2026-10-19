import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// The panel's failed read fell through to the `no_data` copy, so "I couldn't
// look" rendered exactly like "nothing has ever been auto-fixed".

const ipcError = { error: 'database is locked', kind: 'Database' };
const getHealingEffectiveness = vi.fn();
const listHealingAuditLog = vi.fn();
vi.mock('@/api/overview/healing', () => ({
  getHealingEffectiveness: (...a: unknown[]) => getHealingEffectiveness(...a),
  listHealingAuditLog: (...a: unknown[]) => listHealingAuditLog(...a),
}));

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { HealingEffectivenessPanel } from '../HealingEffectivenessPanel';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['overview']);
});

const NO_DATA = /no auto-fix activity yet/i;

describe('HealingEffectivenessPanel read failure', () => {
  it('a failed read is not "no activity", and retry re-reads', async () => {
    getHealingEffectiveness.mockRejectedValueOnce(ipcError).mockResolvedValueOnce({
      window_days: 30, attempted: 0, confirmed: 0, reverted: 0, success_rate: 0, by_category: [],
    });
    listHealingAuditLog.mockResolvedValue([]);

    render(<HealingEffectivenessPanel />);
    const retry = await screen.findByRole('button', { name: /retry/i });
    expect(screen.queryByText(NO_DATA)).toBeNull();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();

    fireEvent.click(retry);
    await waitFor(() => expect(getHealingEffectiveness).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(NO_DATA)).toBeTruthy();
  });
});
