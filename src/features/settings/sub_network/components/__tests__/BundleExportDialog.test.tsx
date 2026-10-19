import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExposedResource } from '@/api/network/exposure';

const resource = vi.hoisted(() => ({
  id: 'exp-1',
  resource_type: 'persona',
  resource_id: 'p-1',
  display_name: 'Researcher',
  access_level: 'read',
}) as ExposedResource);

vi.mock('@/stores/systemStore', () => {
  const store = {
    exposedResources: [resource],
    fetchExposedResources: vi.fn().mockResolvedValue(undefined),
    exportBundle: vi.fn(),
    exportBundleToClipboard: vi.fn(),
    createShareLink: vi.fn(),
    sealEnclave: vi.fn(),
  };
  const useSystemStore = (selector: (s: typeof store) => unknown) => selector(store);
  useSystemStore.getState = () => store;
  return { useSystemStore };
});
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (selector: (s: { personas: []; fetchPersonas: () => void }) => unknown) =>
    selector({ personas: [], fetchPersonas: vi.fn() }),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() }),
}));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { sharing: new Proxy({}, { get: (_target, key) => String(key) }) },
    tx: (value: string) => value,
  }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@/lib/ui/BaseModal', () => ({
  BaseModal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { BundleExportDialog } from '../BundleExportDialog';

describe('BundleExportDialog resource picker', () => {
  it('exposes each resource row as a checkbox with its checked state', () => {
    render(<BundleExportDialog isOpen onClose={vi.fn()} />);
    const row = screen.getByRole('checkbox', { name: /Researcher/ });
    expect(row).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(row);
    expect(screen.getByRole('checkbox', { name: /Researcher/ })).toHaveAttribute('aria-checked', 'true');
  });
});
