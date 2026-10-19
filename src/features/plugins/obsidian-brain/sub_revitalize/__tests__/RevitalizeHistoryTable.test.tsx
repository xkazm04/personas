/**
 * RevitalizeHistoryTable — a failed history read says so.
 *
 * Before: the read's failure was swallowed, `runs` stayed null and the whole
 * section rendered nothing, indistinguishable from a vault never revitalized.
 * The localized copy for it (revitalize_history_load_failed) had no reader.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

const history = vi.fn();
vi.mock('@/api/obsidianBrain', () => ({
  obsidianRevitalizeHistory: (n: number) => history(n),
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ obsidianRevitalizeRunning: false }),
}));

import RevitalizeHistoryTable from '../RevitalizeHistoryTable';

describe('RevitalizeHistoryTable', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['plugins']);
  });

  it('shows the load failure instead of vanishing', async () => {
    history.mockRejectedValue({ error: 'no such table: obsidian_revitalize_runs', kind: 'Database' });

    render(<RevitalizeHistoryTable />);

    expect(await screen.findByText(/Could not load run history/)).toBeTruthy();
  });
});
