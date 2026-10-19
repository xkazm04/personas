import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsAuditEntry } from '@/lib/bindings/SettingsAuditEntry';

const list = vi.hoisted(() => vi.fn());

vi.mock('@/api/system/settings', () => ({ listSettingsAuditEntries: list }));
vi.mock('@/i18n/useTranslation', () => {
  const keys = () => new Proxy({}, { get: (_target, key) => String(key) });
  return {
    useTranslation: () => ({
      t: { settings: { history: keys() }, error_registry: keys() },
    }),
  };
});

import SettingsHistoryTab from '../SettingsHistoryTab';

function entry(id: string, category: string): SettingsAuditEntry {
  return {
    id,
    category,
    settingKey: `${category}.key`,
    action: 'update',
    beforeValue: null,
    afterValue: null,
    actor: null,
    createdAt: '2026-10-01T00:00:00Z',
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  list.mockReset();
});

describe('SettingsHistoryTab reads', () => {
  it('paints the newest category, not whichever read landed last', async () => {
    const vaultRead = deferred<SettingsAuditEntry[]>();
    const appearanceRead = deferred<SettingsAuditEntry[]>();
    list.mockImplementation((_limit: number, category?: string) => {
      if (category === 'vault') return vaultRead.promise;
      if (category === 'appearance') return appearanceRead.promise;
      return Promise.resolve([entry('a1', 'appearance'), entry('v1', 'vault')]);
    });

    render(<SettingsHistoryTab />);
    const select = await screen.findByRole('combobox');
    await screen.findByText('vault.key');

    fireEvent.change(select, { target: { value: 'vault' } });
    fireEvent.change(select, { target: { value: 'appearance' } });

    await act(async () => appearanceRead.resolve([entry('a1', 'appearance')]));
    await act(async () => vaultRead.resolve([entry('v1', 'vault')]));

    expect(screen.getByText('appearance.key')).toBeInTheDocument();
    expect(screen.queryByText('vault.key')).toBeNull();
  });

  it('names a failed read instead of printing [object Object]', async () => {
    list.mockRejectedValue({ error: 'database is locked', kind: 'internal' });
    render(<SettingsHistoryTab />);
    await waitFor(() => expect(screen.getByText('generic_message')).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('[object Object]');
  });
});
