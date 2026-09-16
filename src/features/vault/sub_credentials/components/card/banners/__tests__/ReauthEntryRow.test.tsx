import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ReauthEntry } from '../ReauthEntryRow';

// The vault store is reached through a selector; a plain selector-caller is
// enough and keeps the real slice (and its IPC) out of the test.
const updateCredential = vi.fn();
const storeState = {
  updateCredential,
  connectorDefinitions: [] as unknown[],
};
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

// Capture the hook's callbacks so a test can drive the OAuth round-trip
// deterministically instead of waiting on a real consent window.
let oauthOptions: {
  onSuccess?: (d: { oauth_session_ref: string; scope: string | null }) => void;
  onError?: (m: string) => void;
} = {};
const startConsent = vi.fn();
vi.mock('@/features/vault/shared/hooks/useGoogleOAuth', () => ({
  useGoogleOAuth: (options: typeof oauthOptions) => {
    oauthOptions = options;
    return {
      isAuthorizing: false,
      completedAt: null,
      message: null,
      getValues: () => ({}),
      valuesVersion: 0,
      startConsent,
      reset: vi.fn(),
    };
  },
}));

const { ReauthEntryRow } = await import('../ReauthEntryRow');

function makeEntry(over: Partial<ReauthEntry> = {}): ReauthEntry {
  return {
    credentialId: 'cred-1',
    credentialName: 'Work Drive',
    serviceType: 'google_drive',
    source: null,
    accountEmail: 'ops@acme.com',
    ...over,
  };
}

function renderRow(entry: ReauthEntry) {
  const onNavigate = vi.fn();
  const onDismiss = vi.fn();
  render(
    <ReauthEntryRow
      entry={entry}
      cliSpec={null}
      onNavigate={onNavigate}
      onDismiss={onDismiss}
      onRetryCli={vi.fn()}
    />,
  );
  return { onNavigate, onDismiss };
}

beforeEach(() => {
  updateCredential.mockReset().mockResolvedValue(undefined);
  startConsent.mockReset();
  oauthOptions = {};
});

describe('ReauthEntryRow — which reconnect affordance each entry gets', () => {
  it('offers the in-place Reconnect now for a Google OAuth entry, with the vault as a fallback', () => {
    renderRow(makeEntry());
    expect(screen.getByTestId('reauth-reconnect-now')).toBeTruthy();
    expect(screen.getByTestId('reauth-reconnect').textContent).toContain('Open in vault');
  });

  it('offers only the vault navigation for a non-Google OAuth entry', () => {
    renderRow(makeEntry({ serviceType: 'notion', accountEmail: null }));
    expect(screen.queryByTestId('reauth-reconnect-now')).toBeNull();
    expect(screen.getByTestId('reauth-reconnect').textContent).toContain('Reconnect');
  });

  it('binds the consent to the credential being re-authorized', () => {
    renderRow(makeEntry());
    fireEvent.click(screen.getByTestId('reauth-reconnect-now'));
    expect(startConsent).toHaveBeenCalledWith('google_drive', undefined, 'cred-1');
  });
});

describe('ReauthEntryRow — the bound account line', () => {
  it('names the recorded account', () => {
    renderRow(makeEntry());
    expect(screen.getByTestId('reauth-account-line').textContent).toContain('ops@acme.com');
  });

  it('says the account is not recorded yet when none is bound', () => {
    renderRow(makeEntry({ accountEmail: null }));
    expect(screen.getByTestId('reauth-account-line').textContent).toContain('not recorded yet');
  });

  it('mounts the status region empty, so a later refusal is announced', () => {
    renderRow(makeEntry());
    expect(screen.getByTestId('reauth-row-error').textContent).toBe('');
  });
});

describe('ReauthEntryRow — a different account is refused, and the entry survives', () => {
  it('shows the mismatch inline and keeps the row', async () => {
    updateCredential.mockRejectedValue(
      new Error('oauth_account_mismatch: consent returned other@acme.com'),
    );
    renderRow(makeEntry());

    fireEvent.click(screen.getByTestId('reauth-reconnect-now'));
    await act(async () => {
      oauthOptions.onSuccess?.({ oauth_session_ref: 'sess-ref-1', scope: null });
    });

    const status = screen.getByTestId('reauth-row-error');
    expect(status.textContent).toContain('different account');
    expect(status.textContent).toContain('other@acme.com');
    // The credential is still revoked — the row must not self-clear.
    expect(screen.getByTestId('reauth-entry-cred-1')).toBeTruthy();
  });

  it('saves the session ref through the store on a matching account', async () => {
    renderRow(makeEntry());
    fireEvent.click(screen.getByTestId('reauth-reconnect-now'));
    await act(async () => {
      oauthOptions.onSuccess?.({ oauth_session_ref: 'sess-ref-1', scope: 'drive.readonly' });
    });
    expect(updateCredential).toHaveBeenCalledWith('cred-1', {
      data: { oauth_session_ref: 'sess-ref-1', scopes: 'drive.readonly' },
    });
    expect(screen.getByTestId('reauth-row-error').textContent).toBe('');
  });
});
