import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CloudOAuthPanel, type CloudOAuthPanelProps } from '../CloudOAuthPanel';

function props(over: Partial<CloudOAuthPanelProps> = {}): CloudOAuthPanelProps {
  return {
    oauthStatus: null,
    pendingOAuthState: null,
    oauthStartUrl: null,
    oauthCode: '',
    setOauthCode: vi.fn(),
    onStartOAuth: vi.fn(),
    onCompleteOAuth: vi.fn(),
    onCancelOAuth: vi.fn(),
    onRefreshOAuth: vi.fn(),
    onDisconnectOAuth: vi.fn(),
    ...over,
  };
}
const connected = (isExpired: boolean | null) => ({
  connected: true, scopes: ['read'], expiresAt: '2026-10-01T00:00:00Z', isExpired,
});

describe('CloudOAuthPanel token state', () => {
  it('confirmed expired renders the expired label and the expiry message, not "connected"', () => {
    render(<CloudOAuthPanel {...props({ oauthStatus: connected(true) })} />);
    expect(screen.getByText('Token expired')).toBeTruthy();
    expect(screen.getByText(/This OAuth token has expired/)).toBeTruthy();
    expect(screen.queryByText('Token connected')).toBeNull();
  });

  it('unchecked (null) renders "status unknown", never "connected" or "expired"', () => {
    render(<CloudOAuthPanel {...props({ oauthStatus: connected(null) })} />);
    expect(screen.getByText('Token status unknown')).toBeTruthy();
    expect(screen.getByText(/could not be verified/)).toBeTruthy();
    expect(screen.queryByText('Token connected')).toBeNull();
    expect(screen.queryByText('Token expired')).toBeNull();
  });

  it('confirmed valid renders connected with no warning copy', () => {
    render(<CloudOAuthPanel {...props({ oauthStatus: connected(false) })} />);
    expect(screen.getByText('Token connected')).toBeTruthy();
    expect(screen.queryByText(/could not be verified/)).toBeNull();
    expect(screen.queryByText(/This OAuth token has expired/)).toBeNull();
  });

  it('refresh and disconnect fire their callbacks', () => {
    const p = props({ oauthStatus: connected(false) });
    render(<CloudOAuthPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Refresh token/i }));
    fireEvent.click(screen.getByRole('button', { name: /Disconnect/i }));
    expect(p.onRefreshOAuth).toHaveBeenCalledTimes(1);
    expect(p.onDisconnectOAuth).toHaveBeenCalledTimes(1);
  });

  it('pending flow: complete is disabled until a code is entered', () => {
    const { rerender } = render(<CloudOAuthPanel {...props({ pendingOAuthState: 's', oauthCode: '  ' })} />);
    const complete = screen.getByRole('button', { name: /Complete/i }) as HTMLButtonElement;
    expect(complete.disabled).toBe(true);
    rerender(<CloudOAuthPanel {...props({ pendingOAuthState: 's', oauthCode: 'abc' })} />);
    expect((screen.getByRole('button', { name: /Complete/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('refuses to link an unsafe authorization URL', () => {
    render(<CloudOAuthPanel {...props({ pendingOAuthState: 's', oauthStartUrl: 'javascript:alert(1)' })} />);
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
