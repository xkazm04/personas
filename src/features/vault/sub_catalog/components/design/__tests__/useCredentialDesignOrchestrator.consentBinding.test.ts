import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * A provider-OAuth consent is bound to the client_id/client_secret it was run
 * with: the session ref it leaves behind redeems THAT client's tokens at save
 * time. Editing a field after consent must drop the consent, or Save stores the
 * new client id beside the old client's tokens. The catalog form
 * (CredentialManagerViews onValuesChanged) resets both OAuth hooks; the design
 * orchestrator reset only the Google one.
 */

const designResult = {
  match_existing: null,
  connector: {
    name: 'acme', label: 'Acme', category: 'dev', color: '#000', oauth_type: 'acme',
    fields: [{ key: 'client_id', label: 'Client ID', type: 'text', required: true }],
    healthcheck_config: null, services: [], events: [],
  },
  setup_instructions: '',
  summary: '',
};
const googleOAuth = { reset: vi.fn(), completedAt: null as string | null };
const universalOAuth = { reset: vi.fn(), completedAt: null as string | null };
const health = { invalidate: vi.fn() };

vi.mock('@/hooks/design/credential/useCredentialDesign', () => ({
  useCredentialDesign: () => ({
    phase: 'preview', result: designResult, outputLines: [], error: null, isSaving: false,
    savedCredentialId: null, registeredConnectorName: null,
    start: vi.fn(), refine: vi.fn(), save: vi.fn(), reset: vi.fn(), cancel: vi.fn(), loadTemplate: vi.fn(),
  }),
}));
vi.mock('@/hooks/design/oauth/useOAuthConsent', () => ({
  useOAuthConsent: () => ({
    ...googleOAuth, getValues: () => ({}), message: null, isAuthorizing: false, startConsent: vi.fn(),
  }),
}));
vi.mock('@/hooks/design/oauth/useUniversalOAuth', () => ({
  useUniversalOAuth: () => ({
    ...universalOAuth, getValues: () => ({}), message: null, isAuthorizing: false, startConsent: vi.fn(),
  }),
}));
vi.mock('@/features/vault/shared/hooks/health/useCredentialHealth', () => ({
  useCredentialHealth: () => ({
    ...health, result: null, isHealthchecking: false, setResult: vi.fn(), checkDesign: vi.fn(),
  }),
}));
vi.mock('@/api/auth/authDetect', () => ({
  detectAuthenticatedServices: vi.fn(() => Promise.resolve([])),
  toAuthDetectionInfo: () => [],
}));

import { useCredentialDesignOrchestrator } from '../useCredentialDesignOrchestrator';

describe('useCredentialDesignOrchestrator - consent is bound to the values it ran with', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    googleOAuth.completedAt = null;
    universalOAuth.completedAt = null;
  });

  function changeAField() {
    const { result } = renderHook(() => useCredentialDesignOrchestrator());
    const ctx = result.current.contextValue;
    if (!ctx) throw new Error('expected a context value for a preview-phase design');
    act(() => { ctx.onValuesChanged('client_id', 'other-client'); });
  }

  it('drops a completed provider-OAuth consent when a field changes', () => {
    universalOAuth.completedAt = '12:00';
    changeAField();
    expect(universalOAuth.reset).toHaveBeenCalledTimes(1);
    expect(health.invalidate).toHaveBeenCalled();
  });

  it('still drops a completed Google consent', () => {
    googleOAuth.completedAt = '12:00';
    changeAField();
    expect(googleOAuth.reset).toHaveBeenCalledTimes(1);
  });

  it('leaves both untouched when no consent has completed', () => {
    changeAField();
    expect(universalOAuth.reset).not.toHaveBeenCalled();
    expect(googleOAuth.reset).not.toHaveBeenCalled();
  });
});
