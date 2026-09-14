// TODO(prototype, 2026-09-14): consolidate the notepad overview switcher.
//
// Throwaway copy for the three overview variants. It is deliberately NOT in
// `t.notepad` yet: fourteen locale catalogs per string is a cost worth paying
// for the winner only. At consolidation the winner's strings move to
// `src/i18n/locales/en.json` → translate pipeline, and this file is deleted
// together with the losing variants and the switcher.
export const OVERVIEW_COPY = {
  back: 'All notes',
  open: 'Open in editor',
  open_to_continue: 'Open to keep writing',
  locked: 'Locked — open to read',
  over_limit: 'Past 100 characters — this one finishes in the editor',
  write_prompt: 'Click to write…',
  count: '{count} of {cap} notes',
  capture_placeholder: 'Jot something down — Enter keeps it as a draft',
  variant_cards: 'Index cards',
  variant_lifecycle: 'Lifecycle board',
  variant_desk: 'Project desk',
} as const;

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}
