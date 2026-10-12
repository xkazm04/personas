import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const createCredential = vi.fn(async (_input: unknown) => 'credential-1');
const createConnectorDefinition = vi.fn();
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (selector: (state: unknown) => unknown) => selector({
    connectorDefinitions: [{ id: 'connector-1', name: 'github', label: 'GitHub' }],
    createConnectorDefinition,
    deleteConnectorDefinition: vi.fn(),
    createCredential,
  }),
}));
vi.mock('@/hooks/design/core/useAiArtifactTask', () => ({
  useAiArtifactTask: () => ({
    result: {
      match_existing: null,
      connector: { name: 'GitHub', label: 'GitHub', category: 'developer', color: 'blue', fields: [], healthcheck_config: null, services: [], events: [] },
      setup_instructions: '', summary: '',
    },
    phase: 'preview', lines: [], error: null,
    setPhase: vi.fn(), setError: vi.fn(), setLines: vi.fn(), setResult: vi.fn(),
    start: vi.fn(), cancel: vi.fn(), reset: vi.fn(), cleanup: vi.fn(),
  }),
}));
vi.mock('@/lib/credentials/credentialRecipeRegistry', () => ({ saveRecipeFromDesign: vi.fn(async () => {}) }));

import { useCredentialDesign } from '../useCredentialDesign';

describe('useCredentialDesign', () => {
  it('uses the reused connector name as the credential service type', async () => {
    const { result } = renderHook(() => useCredentialDesign());
    await act(async () => result.current.save('My GitHub', {}));

    expect(createConnectorDefinition).not.toHaveBeenCalled();
    expect(createCredential).toHaveBeenCalledWith({
      name: 'My GitHub', service_type: 'github', data: {},
    });
  });
});
