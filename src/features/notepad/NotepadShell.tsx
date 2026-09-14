import { useEffect } from 'react';
import { NotepadText } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { markNotepadPhase } from './notepadTiming';


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

  // The shell mounting is the moment the screen first changes under the click.
  // If this number is large the problem is upstream of every chunk.
  useEffect(() => {
    markNotepadPhase('shell');
  }, []);

  // The shell mounting is the moment the screen first changes under the click.
  // If this number is large the problem is upstream of every chunk.
  useEffect(() => {
    markNotepadPhase('shell');
  }, []);

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

      {/* The overview's footprint — heading, capture line, first row of cards —
          so the host swaps in under a frame that does not move. Geometry-matched
          to NoteOverview's own padding, h-12 capture line and h-52 cards. */}
      <div className="flex-1 px-8 py-6 flex flex-col gap-5">
        <div className="h-12 w-40 rounded-input bg-secondary/25" />
        <div className="h-12 rounded-card bg-secondary/25" />
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-52 rounded-card bg-secondary/20" />
          ))}
        </div>
      </div>
    </div>
  );
}
