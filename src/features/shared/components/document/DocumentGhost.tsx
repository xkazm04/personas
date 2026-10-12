// @catalog DocumentGhost - calm, static placeholder lines for a long-form document body while it loads (no spinner, no pulse); the reader's chrome stays rendered around it.
/**
 * The ghost under a document reader's permanent chrome: a heading bar and a
 * paragraph's worth of lines in the calm `bg-primary/[0.06]` treatment the
 * loading pattern requires (docs/design/overview-loading.md law 3 - static,
 * lower-contrast, never pulsing).
 */
export function DocumentGhost({ testId = 'document-ghost' }: { testId?: string }) {
  const bar = 'h-3 rounded-card bg-primary/[0.06]';
  return (
    <div className="flex flex-col gap-3 py-2" aria-hidden="true" data-testid={testId}>
      <span className={`${bar} w-2/5`} />
      <span className={`${bar} w-full`} />
      <span className={`${bar} w-11/12`} />
      <span className={`${bar} w-4/5`} />
      <span className={`${bar} w-full`} />
      <span className={`${bar} w-3/5`} />
    </div>
  );
}
