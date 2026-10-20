/** The search box's clear control is icon-only: it needs a name. */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/api/events/sharedEvents', () => ({
  browseCatalog: vi.fn(async () => []),
  listSubscriptions: vi.fn(async () => []),
  changeActivity: vi.fn(async () => []),
  listProjectRoutes: vi.fn(async () => []),
}));

import { SharedEventsTab } from '../SharedEventsTab';

describe('SharedEventsTab search', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  it('names the clear-search control and clears the query with it', async () => {
    render(<SharedEventsTab />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'stripe' } });
    const clear = await screen.findByRole('button', { name: 'Clear search' });
    fireEvent.click(clear);
    expect(input.value).toBe('');
  });
});
