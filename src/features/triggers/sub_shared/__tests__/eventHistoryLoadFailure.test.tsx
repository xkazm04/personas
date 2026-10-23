/** A failed history read must not be presented as an empty history. */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';

const listFirings = vi.fn();
vi.mock('@/api/events/sharedEvents', () => ({
  listFirings: (...a: unknown[]) => listFirings(...a),
  listImpactRuns: vi.fn(async () => []),
}));

import { EventHistoryModal } from '../EventHistoryModal';

// The modal reads id, slug, name, icon and color only.
const entry = { id: 'c1', slug: 'stripe-api', name: 'Stripe API', icon: null, color: null } as Partial<SharedEventCatalogEntry> as SharedEventCatalogEntry;

describe('EventHistoryModal load failure', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  it('says the history could not load, and retries on request', async () => {
    listFirings.mockRejectedValueOnce({ error: 'database is locked', kind: 'Database' });
    render(<EventHistoryModal entry={entry} onClose={() => {}} />);
    expect(await screen.findByText('Could not load history')).toBeTruthy();
    expect(screen.queryByText('No changes recorded yet')).toBeNull();

    listFirings.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('No changes recorded yet')).toBeTruthy();
    expect(listFirings).toHaveBeenCalledTimes(2);
  });
});
