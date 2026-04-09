/**
 * English source-of-truth for the Templates feature.
 *
 * Convention: every key here MUST exist in all 13 other locale files in this
 * folder. When you add a key, also add it to the others (use the English value
 * as a placeholder + a `// TODO(i18n-XX)` marker so untranslated strings are
 * grep-able). See `.claude/CLAUDE.md` → "UI Conventions → Internationalization".
 */
export const en = {
  templates: {
    complexity: {
      beginner: 'Beginner',
      intermediate: 'Intermediate',
      advanced: 'Advanced',
      quickSetup: 'Quick Setup',
      moderateSetup: 'Moderate Setup',
      involvedSetup: 'Involved Setup',
      /** Used in the combined badge: "Beginner · ~5 min" */
      minuteShort: '~{minutes}m',
      /** Used in the modal badge: "Beginner · ~5 min setup" */
      minuteSetup: '~{minutes} min setup',
    },
  },
};
