import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

/**
 * `CatalogAutoSetup` and the `AutoCredPanel` it mounts both probe Playwright
 * availability in the same commit. Each probe is a backend
 * `npx --yes @playwright/mcp@latest --help` spawn on a cold cache, so two
 * concurrent probes were two processes for one answer.
 */

let resolveProbe: ((ok: boolean) => void) | null = null;
const checkPlaywrightAvailable = vi.fn(
  () => new Promise<boolean>((resolve) => { resolveProbe = resolve; }),
);

vi.mock('@/api/vault/autoCredBrowser', () => ({
  checkPlaywrightAvailable: () => checkPlaywrightAvailable(),
  startAutoCredBrowser: vi.fn(),
  cancelAutoCredBrowser: vi.fn(async () => {}),
  getPlaywrightProcedure: vi.fn(async () => null),
  savePlaywrightProcedure: vi.fn(),
}));
vi.mock('@/lib/credentials/credentialRecipeRegistry', () => ({
  lookupRecipeAsDesignResult: vi.fn(async () => null),
}));
vi.mock('@/features/vault/sub_credentials/components/picker/usePostSaveResourcePicker', () => ({
  usePostSaveResourcePicker: () => ({ promptIfScoped: vi.fn() }),
}));

import { probeAutoCredMode } from '../probeAutoCredMode';
import { CatalogAutoSetup } from '../../steps/CatalogAutoSetup';
import type { ConnectorDefinition } from '@/lib/types/types';

describe('probeAutoCredMode: one probe for concurrent callers', () => {
  beforeEach(() => {
    checkPlaywrightAvailable.mockClear();
    resolveProbe = null;
  });

  it('shares an in-flight probe and re-probes after it settles', async () => {
    const a = probeAutoCredMode();
    const b = probeAutoCredMode();
    expect(checkPlaywrightAvailable).toHaveBeenCalledTimes(1);
    resolveProbe!(false);
    await expect(a).resolves.toBe('guided');
    await expect(b).resolves.toBe('guided');

    const c = probeAutoCredMode();
    expect(checkPlaywrightAvailable).toHaveBeenCalledTimes(2);
    resolveProbe!(true);
    await expect(c).resolves.toBe('playwright');
  });

  it('a catalog auto-setup open probes once, not once per component', async () => {
    const connector = {
      name: 'acme',
      label: 'Acme',
      category: 'api',
      color: '#123456',
      fields: [{ key: 'api_key', label: 'API Key', type: 'password', required: true }],
      metadata: { setup_instructions: 'Open https://example.com/keys and create a key.' },
      healthcheck_config: null,
    } as unknown as ConnectorDefinition;

    const view = render(<CatalogAutoSetup connector={connector} onComplete={vi.fn()} onCancel={vi.fn()} />);
    await act(async () => {});
    // Both probing components are mounted: the setup shell and its panel.
    expect(view.getByTestId('vault-catalog-auto-setup').getAttribute('data-phase')).toBe('auto');
    expect(view.getByTestId('vault-autocred-panel')).toBeTruthy();
    expect(checkPlaywrightAvailable).toHaveBeenCalledTimes(1);
    await act(async () => { resolveProbe!(true); });
  });
});
