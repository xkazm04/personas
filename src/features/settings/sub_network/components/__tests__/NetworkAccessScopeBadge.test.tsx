import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NetworkAccessScope } from '@/api/network/bundle';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { sharing: new Proxy({}, { get: (_target, key) => String(key) }) } }),
}));

import { NetworkAccessScopeBadge } from '../NetworkAccessScopeBadge';

function scope(level: string): NetworkAccessScope {
  // The Rust struct types `level` as a bare String: model a level this build
  // has never heard of arriving over IPC.
  return { level, domains: [], tool_integrations: [], api_endpoints: [] } as NetworkAccessScope;
}

describe('NetworkAccessScopeBadge', () => {
  it('shows an unknown scope level as the broadest scope, never as "no network access"', () => {
    render(<NetworkAccessScopeBadge scope={scope('wildcard')} />);
    expect(screen.getByText('scope_unrestricted_label')).toBeInTheDocument();
    expect(screen.queryByText('scope_none_label')).toBeNull();
  });

  it('keeps the known levels', () => {
    render(<NetworkAccessScopeBadge scope={scope('none')} />);
    expect(screen.getByText('scope_none_label')).toBeInTheDocument();
  });
});
