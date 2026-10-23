/**
 * THE ACTIVE TOGGLE'S ACCESSIBLE NAME IS TRANSLATED.
 *
 * The switch's label was built from two English literals ("Enable"/"Disable"
 * + name), so a screen reader in any of the other 13 locales announced it in
 * English. Pinned: the name comes from `common.enable_item` /
 * `common.disable_item`, the catalog keys that already carry the `{name}` slot.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PersonaWithDetails } from '@/lib/types/types';
import type { PersonaDraft } from '../../libs/PersonaDraft';

vi.mock('@/stores/selectors/personaSelectors', () => ({
  useParsedDesignContext: () => ({ labTestMetadata: null }),
}));
const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'agents'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t,
    tx: (s: unknown, vars?: Record<string, unknown>) => `${String(s)}|${String(vars?.name ?? '')}`,
    language: 'en',
  }),
  getActiveTranslations: () => t,
}));

import { PersonaEditorHeader } from '../PersonaEditorHeader';
import { useAgentStore } from '@/stores/agentStore';

const persona = (enabled: boolean) => ({
  id: 'p1', name: 'Support bot', description: null, icon: null, color: null, enabled,
  setup_status: 'ready', setup_detail: null, tools: [], triggers: [], subscriptions: [],
}) as unknown as PersonaWithDetails;

function renderFor(enabled: boolean) {
  useAgentStore.setState({ selectedPersona: persona(enabled) });
  const draft = { name: 'Support bot', description: '', icon: '', color: '', enabled } as unknown as PersonaDraft;
  return render(<PersonaEditorHeader draft={draft} baseline={draft} patch={() => {}} setBaseline={() => {}} />);
}

describe('PersonaEditorHeader active toggle label', () => {
  it('names the enable action through the catalog', () => {
    renderFor(false);
    expect(screen.getByRole('switch')).toHaveAccessibleName('common.enable_item|Support bot');
  });

  it('names the disable action through the catalog', () => {
    renderFor(true);
    expect(screen.getByRole('switch')).toHaveAccessibleName('common.disable_item|Support bot');
  });
});
