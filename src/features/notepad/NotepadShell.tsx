import { NotepadText } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

/**
 * What the pad looks like in the instant between the click and the chunk.
 *
 * The Suspense fallback used to be `null`, which is the one thing a summoned
 * overlay must never be: the click landed, the footer icon lit up, and the
 * screen did not change until the chunk resolved — a delay the operator reads
 * as "the button is broken", not as "the app is loading". This paints the
 * overlay's OWN geometry and chrome in the first frame (same top offset, same
 * opaque ground, same header row), so the real host swaps in underneath a
 * frame that never moved.
 *
 * It is a ghost, not a spinner: the pad is a SURFACE loading its content, and
 * a spinner on a surface is banned app-wide (docs/design/overview-loading.md).
 * With a warm chunk this is never seen at all — which is the point of the
 * prefetch in `notepadHostChunk`.
 */
export default function NotepadShell() {
  const { t } = useTranslation();

  return (
    <div
      aria-hidden
      data-testid="notepad-shell"
      className="fixed inset-x-0 bottom-8 top-[var(--titlebar-height,40px)] z-[200] flex flex-col bg-background"
    >
      <div className="flex items-center justify-between gap-3 px-4 h-10 border-b border-primary/10">
        <span className="flex items-center gap-2 typo-caption text-foreground/60">
          <NotepadText className="w-4 h-4" aria-hidden />
          {t.notepad.title}
        </span>
      </div>

      {/* The tab strip's footprint, so the strip does not push the body down
          when it arrives. Geometry-matched to NoteTabStrip's own h-11 row. */}
      <div className="flex items-center gap-1 px-3 h-11 border-b border-primary/10">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 w-32 rounded-interactive bg-secondary/25" />
        ))}
      </div>

      <div className="flex-1" />
    </div>
  );
}
