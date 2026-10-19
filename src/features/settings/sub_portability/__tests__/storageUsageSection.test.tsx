import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

const storageUsage = vi.fn();

vi.mock('@/api/system/system', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  storageUsage: () => storageUsage(),
  pruneStorage: vi.fn(),
  reclaimStorage: vi.fn(),
}));

import { StorageUsageSection } from '../components/StorageUsageSection';

const REPORT = {
  databaseBytes: 1024, totalExecutions: 3, prunableExecutions: 0, databaseFreeBytes: 0,
  walBytes: 0, backupsBytes: 0, backupSets: 0, logsBytes: 0, logFiles: 0,
};

describe('StorageUsageSection', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });
  beforeEach(() => { storageUsage.mockReset(); });

  it('says the report failed instead of rendering an empty section, and retries', async () => {
    // invokeWithTimeout rejects with a serialized AppError object, not an Error.
    storageUsage.mockRejectedValueOnce({ error: 'database is locked', kind: 'Database' });
    storageUsage.mockResolvedValueOnce(REPORT);
    render(<StorageUsageSection />);

    const failed = await screen.findByTestId('storage-usage-load-failed');
    expect(failed.textContent).not.toContain('[object Object]');
    expect(failed.textContent?.trim().length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(storageUsage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('storage-usage-load-failed')).toBeNull());
  });
});
