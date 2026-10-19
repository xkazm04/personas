import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { AgentIR } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));
vi.mock('@/stores/selectors/personaSelectors', () => ({
  useSelectedCredentialLinks: () => ({ github: 'cred-1' }),
}));

import { ConnectorsSection } from '../ConnectorsSection';

const RESULT = { suggested_connectors: [{ name: 'github' }], suggested_tools: [] } as unknown as AgentIR;
const CREDS = [
  { id: 'cred-1', name: 'GH', service_type: 'github', healthcheck_last_success: true },
] as unknown as CredentialMetadata[];
const DEFS = [{ name: 'github', label: 'GitHub', category: 'devops', fields: [] }] as unknown as ConnectorDefinition[];

function renderSection(testing: boolean) {
  return render(
    <ConnectorsSection
      result={RESULT}
      allToolDefs={[]}
      currentToolNames={[]}
      credentials={CREDS}
      connectorDefinitions={DEFS}
      selectedTools={new Set()}
      onToolToggle={vi.fn()}
      onTestConnector={vi.fn()}
      testingConnectors={new Set(testing ? ['github'] : [])}
      readOnly
    />,
  );
}

describe('ConnectorsSection verify control', () => {
  it('shows a busy indicator while the healthcheck runs', () => {
    renderSection(true);
    const verify = screen.getByRole('button', { name: en.agents.connectors.st_test });
    expect(verify.getAttribute('aria-busy')).toBe('true');
    expect((verify as HTMLButtonElement).disabled).toBe(true);
    expect(verify.querySelector('svg')).not.toBeNull();
  });

  it('is an idle, pressable control otherwise', () => {
    renderSection(false);
    const verify = screen.getByRole('button', { name: en.agents.connectors.st_test });
    expect(verify.getAttribute('aria-busy')).toBeNull();
    expect((verify as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ConnectorsSection credential status', () => {
  it('explains the status through the Tooltip primitive, reachable by keyboard focus', () => {
    vi.useFakeTimers();
    try {
      render(
        <ConnectorsSection
          result={RESULT}
          allToolDefs={[]}
          currentToolNames={[]}
          credentials={CREDS}
          connectorDefinitions={DEFS}
          selectedTools={new Set()}
          onToolToggle={vi.fn()}
          onConnectorClick={vi.fn()}
          readOnly
        />,
      );
      const status = screen.getByRole('button', { name: en.templates.design.credential_ready });
      expect(status.getAttribute('title')).toBeNull();
      act(() => { status.focus(); });
      act(() => { vi.advanceTimersByTime(2000); });
      // Positioned on the next frame, so query past the not-yet-visible style.
      expect(screen.getByRole('tooltip', { hidden: true }).textContent).not.toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});
