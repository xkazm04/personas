import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BundleImportPreview } from '@/api/network/bundle';

const previewShareLink = vi.hoisted(() => vi.fn());

vi.mock('@/stores/systemStore', () => {
  const store = {
    previewBundleImport: vi.fn(),
    previewBundleFromClipboard: vi.fn(),
    previewShareLink,
    applyBundleImport: vi.fn(),
    applyBundleFromClipboard: vi.fn(),
    importFromShareLink: vi.fn(),
    verifyEnclave: vi.fn(),
  };
  return { useSystemStore: (selector: (s: typeof store) => unknown) => selector(store) };
});
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() }),
}));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { sharing: new Proxy({}, { get: (_target, key) => String(key) }) },
    tx: (value: string) => value,
  }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../BundlePreviewContent', () => ({
  BundlePreviewContent: ({ preview }: { preview: BundleImportPreview }) => (
    <div data-testid="preview">{preview.signer_display_name}</div>
  ),
}));

import { BundleImportDialog } from '../BundleImportDialog';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const previewB = {
  preview_id: 'pv-b',
  signer_peer_id: 'peer-b-0000000000000000',
  signer_display_name: 'Signer B',
  signature_valid: true,
  signer_trusted: true,
  resources: [],
  network_scope: { level: 'none', domains: [], tool_integrations: [], api_endpoints: [] },
  bundle_hash: 'hash-b',
  created_at: '2026-10-01T00:00:00Z',
} as BundleImportPreview;

describe('BundleImportDialog superseded share-link preview', () => {
  it('does not paint an older link failure over the newer preview', async () => {
    const linkA = deferred<BundleImportPreview>();
    previewShareLink.mockImplementation((url: string) =>
      url.endsWith('/A') ? linkA.promise : Promise.resolve(previewB),
    );

    const view = render(
      <BundleImportDialog isOpen onClose={vi.fn()} initialShareUrl="personas://share/A" shareLinkKey={1} />,
    );
    await act(async () => {});
    view.rerender(
      <BundleImportDialog isOpen onClose={vi.fn()} initialShareUrl="personas://share/B" shareLinkKey={2} />,
    );
    await act(async () => {});
    expect(screen.getByTestId('preview')).toHaveTextContent('Signer B');

    await act(async () => linkA.reject({ error: 'link A expired', kind: 'not_found' }));

    expect(screen.queryByText('link A expired')).toBeNull();
    expect(screen.getByRole('button', { name: /import_btn/ })).toBeInTheDocument();
  });
});
