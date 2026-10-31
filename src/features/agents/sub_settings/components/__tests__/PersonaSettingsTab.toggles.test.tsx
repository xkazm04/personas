/**
 * The two described switches (sensitive preview, CLI awareness) expose their
 * visible description programmatically, and the description ranks below the label.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/system/settings', () => ({
  getAppSetting: () => Promise.resolve(null),
  setAppSetting: () => Promise.resolve(),
}));
vi.mock('@/lib/silentCatch', () => ({ toastCatch: () => () => undefined, silentCatch: () => () => undefined }));
vi.mock('@/hooks/utility/interaction/useTier', () => ({ useTier: () => ({ isStarter: false }) }));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: unknown) => unknown) => sel({ selectedPersonaId: null, selectedPersona: null }),
}));
vi.mock('./../PersonaAssertionsSection', () => ({ PersonaAssertionsSection: () => null }));
vi.mock('@/features/agents/sub_editor/components/DeepFanoutToggle', () => ({ DeepFanoutToggle: () => null }));
vi.mock('@/features/shared/components/forms/PopupColorPicker', () => ({ PopupColorPicker: () => null }));
vi.mock('@/features/agents/components/PersonaIconPickerModal', () => ({ PersonaIconPickerModal: () => null }));
vi.mock('../SettingsStatusBar', () => ({ SettingsStatusBar: () => null }));

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'agents'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { PersonaSettingsTab } from '../PersonaSettingsTab';

function renderTab() {
  const draft = { name: 'n', description: '', icon: '', color: '#fff', sensitive: false, cliAwarenessEnabled: false, maxConcurrent: 1, timeout: 60000 };
  return render(
    <PersonaSettingsTab
      draft={draft as never}
      patch={() => undefined}
      isDirty={false}
      changedSections={[]}
      showDeleteConfirm={false}
      setShowDeleteConfirm={() => undefined}
      isSaving={false}
      onDelete={async () => undefined}
    />,
  );
}

describe('PersonaSettingsTab described switches', () => {
  it('describes the sensitive-preview and CLI-awareness switches', () => {
    renderTab();
    const sensitive = screen.getByRole('switch', { name: 'settings_status.sensitive_preview' });
    const cli = screen.getByRole('switch', { name: 'settings_status.cli_awareness' });
    expect(sensitive).toHaveAccessibleDescription('settings_status.sensitive_preview_desc');
    expect(cli).toHaveAccessibleDescription('settings_status.cli_awareness_desc');
  });

  it('sets each description in the caption step, below its label', () => {
    renderTab();
    for (const id of ['persona-sensitive-preview-desc', 'persona-cli-awareness-desc']) {
      const desc = document.getElementById(id);
      expect(desc?.className).toContain('typo-caption');
      expect(desc?.className).not.toContain('typo-body');
    }
  });
});
