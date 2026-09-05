import { describe, it, expect } from 'vitest';
import { tabIdLabel, tabIdsToLabels, TAB_LABELS } from '../editorTabConstants';

const catalog = { use_cases: 'Cas d’usage', settings: 'Paramètres', model: 'Modèle' };

describe('dirty-tab labels resolve through one translated catalog', () => {
  it('reads the agents.editor.tabs catalog, mapping hyphenated ids to underscore keys', () => {
    expect(tabIdLabel('use-cases', catalog)).toBe('Cas d’usage');
    expect(tabIdLabel('settings', catalog)).toBe('Paramètres');
  });

  it('falls back to the English table, then to the capitalised id', () => {
    expect(tabIdLabel('prompt', catalog)).toBe(TAB_LABELS.prompt);
    expect(tabIdLabel('notifications', catalog)).toBe('Notifications');
    expect(tabIdLabel('notifications')).toBe('Notifications');
  });

  it('joins a list the way the toast and the banner both render it', () => {
    expect(tabIdsToLabels(['settings', 'model'], catalog)).toBe('Paramètres, Modèle');
  });
});
