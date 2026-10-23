import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { AuthDetectionInfo } from '@/hooks/design/credential/useCredentialNegotiator';

/**
 * The orchestrator prefetches auth detections while the design is analyzing and
 * hands them to the panel as `prefetchedAuthDetections`. When the panel opens
 * before that prefetch lands it starts its own detect; the prefetch then
 * arrives, the effect re-runs and cancels the in-flight detect, and the
 * `.finally` that would clear the loading flag is skipped. The Start button is
 * disabled while loading, so the negotiator could never be started.
 */

const pendingDetect: { resolve: (v: unknown[]) => void } = { resolve: () => {} };

vi.mock('@/api/auth/authDetect', () => ({
  detectAuthenticatedServices: vi.fn(
    () => new Promise<unknown[]>((resolve) => { pendingDetect.resolve = resolve; }),
  ),
  toAuthDetectionInfo: (d: unknown[]) => d,
}));

vi.mock('@/hooks/design/credential/useCredentialNegotiator', () => ({
  useCredentialNegotiator: () => ({
    phase: 'idle',
    progressLines: [],
    plan: null,
    error: null,
    activeStepIndex: 0,
    completedSteps: new Set<number>(),
    capturedValues: {},
    stepHelp: null,
    isLoadingHelp: false,
    visibleSteps: [],
    skippedSteps: [],
    start: vi.fn(),
    cancel: vi.fn(),
    completeStep: vi.fn(),
    captureValue: vi.fn(),
    goToStep: vi.fn(),
    requestStepHelp: vi.fn(),
  }),
}));

import { NegotiatorPanel } from '../NegotiatorPanel';

const designResult: CredentialDesignResult = {
  match_existing: null,
  connector: {
    name: 'github', label: 'GitHub', category: 'dev', color: '#000',
    fields: [], healthcheck_config: null, services: [], events: [],
  },
  setup_instructions: '',
  summary: '',
};

function panel(prefetched?: AuthDetectionInfo[]) {
  return (
    <NegotiatorPanel
      designResult={designResult}
      onComplete={vi.fn()}
      onClose={vi.fn()}
      prefetchedAuthDetections={prefetched}
    />
  );
}

const ghSession: AuthDetectionInfo = {
  serviceType: 'github', method: 'gh CLI', authenticated: true, identity: null, confidence: 'high',
};

describe('NegotiatorPanel - a prefetch that lands after the panel opened', () => {
  beforeEach(() => { pendingDetect.resolve = () => {}; });

  it('enables Start once the late prefetch arrives, even though its own detect was cancelled', async () => {
    const view = render(panel(undefined));
    expect(screen.getByTestId('vault-negotiator-start').hasAttribute('disabled')).toBe(true);

    view.rerender(panel([]));
    await act(async () => { pendingDetect.resolve([]); });

    expect(screen.getByTestId('vault-negotiator-start').hasAttribute('disabled')).toBe(false);
  });

  it('reads the late prefetched detections instead of the empty initial list', async () => {
    const view = render(panel(undefined));
    view.rerender(panel([ghSession]));
    await act(async () => { pendingDetect.resolve([]); });

    expect(screen.getByTestId('vault-negotiator-start').textContent).toContain('Use existing GitHub session');
  });

  it('still clears loading from its own detect when no prefetch is coming', async () => {
    render(panel(undefined));
    await act(async () => { pendingDetect.resolve([]); });
    expect(screen.getByTestId('vault-negotiator-start').hasAttribute('disabled')).toBe(false);
  });
});
