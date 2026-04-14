/**
 * English source-of-truth for settings section labels.
 *
 * Convention: every key here MUST exist in all 13 other locale files in this
 * folder. When you add a key, also add it to the others (use the English value
 * as a placeholder + a `// TODO(i18n-XX)` marker so untranslated strings are
 * grep-able). See `.claude/CLAUDE.md` → "UI Conventions → Internationalization".
 *
 * These labels replace internal jargon with plain-language alternatives so
 * non-technical users feel confident navigating settings.
 */
export const en = {
  settings: {
    /** Sidebar + component labels for renamed settings sections */
    byom: {
      sidebarLabel: 'Model Providers',
      title: 'Model Providers',
      subtitle: 'Choose which AI models your agents use',
      loadingSubtitle: 'Loading...',
      policyToggleTitle: 'Model Provider Rules',
      policyToggleDescription: 'When enabled, provider selection follows your configured rules',
      policyToggleLabel: 'Model provider rules',
      corruptTitle: 'Model Provider Policy Corrupted',
      unsavedSection: 'Model Provider Policy',
    },
    qualityGates: {
      sidebarLabel: 'Content Filters',
      title: 'Content Filters',
      subtitle: '{count} active filter rules',
      loadingSubtitle: 'Loading...',
      errorSubtitle: 'Error loading config',
      description:
        'Content filters review AI-generated memories and reviews during execution. ' +
        'Patterns are matched as substrings against the combined title and content of each ' +
        'submission. When a pattern matches, the configured action is applied. These filters ' +
        'prevent operational noise from polluting your knowledge base.',
      loadingMessage: 'Loading content filter configuration...',
    },
    configResolution: {
      sidebarLabel: 'Agent Configuration',
      title: 'Agent Configuration Overview',
      subtitle: 'Shows which tier (agent / workspace / global) supplies each setting per agent',
    },
    ambientContext: {
      title: 'Desktop Awareness',
      toggleLabel: 'Desktop awareness',
      description:
        'Desktop awareness captures clipboard, file changes, and app focus signals to give your agents awareness of your desktop workflow.',
    },
  },
};
