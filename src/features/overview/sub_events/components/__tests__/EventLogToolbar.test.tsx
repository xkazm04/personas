import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { SavedView } from '@/lib/bindings/SavedView';
import { EventLogToolbar } from '../EventLogToolbar';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['overview']);
});

const view = { id: 'v1', name: 'Failures' } as SavedView;

function renderToolbar(over: Partial<Parameters<typeof EventLogToolbar>[0]> = {}) {
  const props = {
    searchText: '', setSearchText: vi.fn(), isSearching: false,
    hasActiveFilters: false, clearFilters: vi.fn(),
    savedViews: [view], activeViewId: null,
    saveCurrentView: vi.fn(() => Promise.resolve()), applySavedView: vi.fn(), removeSavedView: vi.fn(),
    ...over,
  };
  return { props, ...render(<EventLogToolbar {...props} />) };
}

describe('EventLogToolbar saved-view chips', () => {
  it('never nests the delete button inside the apply button', () => {
    const { container } = renderToolbar();
    expect(container.querySelector('button button')).toBeNull();
  });

  it('delete is its own named control and does not apply the view', () => {
    const { props } = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /delete view: failures/i }));
    expect(props.removeSavedView).toHaveBeenCalledWith('v1');
    expect(props.applySavedView).not.toHaveBeenCalled();
  });
});

describe('EventLogToolbar save view', () => {
  it('keeps the name field open when the save did not land', async () => {
    const saveCurrentView = vi.fn(() => Promise.resolve(false));
    renderToolbar({ hasActiveFilters: true, saveCurrentView });
    fireEvent.click(screen.getByRole('button', { name: /save view/i }));
    const input = screen.getByPlaceholderText(/name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My view' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(saveCurrentView).toHaveBeenCalledWith('My view');
    expect((screen.getByPlaceholderText(/name/i) as HTMLInputElement).value).toBe('My view');
  });
});
