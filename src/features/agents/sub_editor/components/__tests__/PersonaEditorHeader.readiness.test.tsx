import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PersonaWithDetails } from '@/lib/types/types';
import type { PersonaDraft } from '../../libs/PersonaDraft';

vi.mock('@/stores/selectors/personaSelectors', () => ({
  useParsedDesignContext: () => ({ labTestMetadata: null }),
}));

import { PersonaEditorHeader } from '../PersonaEditorHeader';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useSystemStore } from '@/stores/systemStore';

function persona(over: Partial<PersonaWithDetails> = {}): PersonaWithDetails {
  return {
    id: 'p1',
    name: 'Support bot',
    description: null,
    icon: null,
    color: null,
    enabled: false,
    setup_status: 'ready',
    setup_detail: null,
    tools: [],
    triggers: [],
    subscriptions: [],
    ...over,
  } as unknown as PersonaWithDetails;
}

const draft = { name: 'Support bot', description: '', icon: '', color: '', enabled: false } as unknown as PersonaDraft;

function renderHeader() {
  return render(
    <PersonaEditorHeader draft={draft} baseline={draft} patch={() => {}} setBaseline={() => {}} />,
  );
}

describe('PersonaEditorHeader readiness fix-it rows', () => {
  beforeEach(() => {
    useSystemStore.setState({ editorTab: 'activity', designSubTab: 'manifest' });
    useVaultStore.setState({ credentials: [] });
  });

  it('lands on the responsibilities surface for a persona with no triggers', () => {
    useAgentStore.setState({ selectedPersona: persona() });
    renderHeader();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByTestId('readiness-fix-no_triggers_or_subs'));
    expect(useSystemStore.getState().editorTab).toBe('design');
    expect(useSystemStore.getState().designSubTab).toBe('responsibilities');
  });

  it('lands on the connectors surface for a missing credential', () => {
    useAgentStore.setState({
      selectedPersona: persona({
        triggers: [{ id: 't1' }] as unknown as PersonaWithDetails['triggers'],
        tools: [{ id: 'tool1', requires_credential_type: 'github' }] as unknown as PersonaWithDetails['tools'],
      }),
    });
    renderHeader();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByTestId('readiness-fix-missing_credentials'));
    expect(useSystemStore.getState().editorTab).toBe('design');
    expect(useSystemStore.getState().designSubTab).toBe('connectors');
  });
});
