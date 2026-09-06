import { describe, it, expect } from 'vitest';
import { tabIdLabel, tabIdsToLabels, TAB_LABELS } from '../editorTabConstants';

// The full closed catalog — the resolver's type requires every arm, which is
// the property that makes a missing translation a compile error.
const catalog = {
  use_cases: 'Cas d’usage', prompt: 'Invite', lab: 'Labo', connectors: 'Connecteurs',
  design: 'Conception', health: 'Santé', settings: 'Paramètres', model: 'Modèle',
};

describe('dirty-tab labels resolve through one translated catalog', () => {
  it('reads the agents.editor.tabs catalog, mapping hyphenated ids to underscore keys', () => {
    expect(tabIdLabel('use-cases', catalog)).toBe('Cas d’usage');
    expect(tabIdLabel('settings', catalog)).toBe('Paramètres');
  });

  it('falls back to the English table when no catalog is supplied', () => {
    expect(tabIdLabel('prompt')).toBe(TAB_LABELS.prompt);
  });

  it('humanizes an id the closed catalog does not carry', () => {
    // 'notifications' is a registered dirty group (the channels surface) with
    // no arm in agents.editor.tabs — it must never surface as a raw token.
    expect(tabIdLabel('notifications', catalog)).toBe('Notifications');
    expect(tabIdLabel('notifications')).toBe('Notifications');
  });

  it('joins a list the way the toast and the banner both render it', () => {
    expect(tabIdsToLabels(['settings', 'model'], catalog)).toBe('Paramètres, Modèle');
  });
});
