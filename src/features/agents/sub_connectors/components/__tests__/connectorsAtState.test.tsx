/**
 * Card 27: two controls rendered their state visually only. The demand card's
 * Reuse toggle opens a credential list with no aria-expanded, and the design
 * progress bar was a bare div with no progressbar role or value.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { UnfulfilledCredential } from '../../libs/useUnfulfilledCredentials';
import type { CredentialMetadata } from '@/lib/types/types';

beforeAll(() => preloadSectionsAsync('en', ['vault', 'agents', 'overview']));

vi.mock('@/features/vault/sub_catalog/components/design/CredentialDesignModal', () => ({ CredentialDesignModal: () => null }));
vi.mock('@/hooks/design/core/useDesignContextMutator', () => ({ mutateCredentialLink: vi.fn() }));
vi.mock('@/stores/agentStore', () => ({ useAgentStore: (sel: (s: unknown) => unknown) => sel({ selectedPersona: { id: 'p1' } }) }));
vi.mock('@/stores/vaultStore', () => ({ useVaultStore: (sel: (s: unknown) => unknown) => sel({ fetchCredentials: vi.fn() }) }));

const demand: UnfulfilledCredential = {
  connectorName: 'github', connectorLabel: 'GitHub', connectorColor: '#000000', connectorCategory: 'source_control',
  personaId: 'p1', personaName: 'Agent', personaColor: '#000000',
  matchingCredentials: [{ id: 'c1', name: 'Work GitHub', service_type: 'github' } as unknown as CredentialMetadata],
};
vi.mock('../../libs/useUnfulfilledCredentials', () => ({
  useUnfulfilledCredentials: () => ({ totalDemands: 1, fulfilledCount: 0, unfulfilledCount: 1, reusableCount: 1, demands: [demand] }),
}));

import { AgentCredentialDemands } from '../connectors/AgentCredentialDemands';
import { AutomationActionStep } from '../automation/AutomationActionStep';

describe('connectors controls expose their state', () => {
  it('the demand card Reuse toggle reports aria-expanded', () => {
    render(<AgentCredentialDemands />);
    const toggle = screen.getByRole('button', { name: /reuse/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('the design progress bar is a progressbar with a value', () => {
    render(
      <AutomationActionStep elapsed={0} stageIndex={2} tailLines={[]} outputLinesLength={0}
        tailRef={createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement>} onCancel={() => {}} />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('4');
    expect(bar.getAttribute('aria-valuetext')).toBe('Designing automation');
  });
});
