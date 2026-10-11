import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { DiscoveredPeer } from '@/api/network/discovery';

const state = {
  peerManifests: {},
  fetchPeerManifest: vi.fn(),
  syncPeerManifest: vi.fn(),
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (store: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock('@/hooks/useTauriEvent', () => ({ useTypedTauriEvent: vi.fn() }));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { sharing: new Proxy({}, { get: (_target, key) => String(key) }) } }),
}));
vi.mock('@/lib/ui/BaseModal', async () => {
  const { useEffect } = await import('react');
  return {
    BaseModal: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => {
      useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [onClose]);
      return <div>{children}</div>;
    },
  };
});

import { PeerDetailDrawer } from '../PeerDetailDrawer';

const peer: DiscoveredPeer = {
  peer_id: 'peer-1', display_name: 'Peer One', addresses: [],
  first_seen_at: '2026-10-01T00:00:00Z', last_seen_at: '2026-10-01T00:00:00Z',
  is_connected: false, metadata: null, trust_status: 'unknown',
};

describe('PeerDetailDrawer keyboard handling', () => {
  it('lets BaseModal close the drawer once on Escape', () => {
    const onClose = vi.fn();
    render(<PeerDetailDrawer peer={peer} isTrusted={false} onClose={onClose} onConnect={vi.fn()} onDisconnect={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
