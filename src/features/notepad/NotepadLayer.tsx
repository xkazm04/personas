import { Suspense, useEffect } from 'react';

import { idlePrefetch } from '@/lib/idlePrefetch';
import { useSystemStore } from '@/stores/systemStore';

import NotepadShell from './NotepadShell';
import { NotepadOverlayHostLazy, notepadHostImport } from './notepadHostChunk';
import { startNotepadListeners } from './notepadStore';

/**
 * App-wide host for the notepad overlay.
 *
 * Same shape as `FleetGridLayer`, and for the same reason: the notepad is a
 * LAYER, not a page. Raising it from the footer over whatever you were looking
 * at means jotting something down never costs a navigation, and closing it
 * puts you back exactly where you were because you never left.
 *
 * This component is deliberately cheap. It owns the open/closed gate, the one
 * always-on side effect the feature needs (the sweeper listener, which must
 * run whether or not the overlay has ever been opened — a note published
 * yesterday can complete while the notepad is shut), and the WARMING of the
 * overlay chunk.
 *
 * The warming is the difference between a pad that opens and a pad that seems
 * to hang. `lazy()` fetches, parses and evaluates the chunk on FIRST RENDER,
 * so before this the first click paid the whole cost with `fallback={null}` on
 * screen — nothing at all until it landed. Now the chunk is queued for an idle
 * slice at mount (`idlePrefetch` serializes it behind whatever else the app is
 * warming, so it never competes with startup), the footer icon warms it again
 * on hover, and the fallback is the pad's own opaque shell rather than nothing.
 * Cold, warm or mid-flight, the click paints a pad in the next frame.
 */
export default function NotepadLayer() {
  const open = useSystemStore((s) => s.notepadOpen);

  useEffect(() => {
    startNotepadListeners();
  }, []);

  useEffect(() => {
    // Deliberately after the startup window: the pad is a "some time today"
    // surface, not a first-paint one, and a chunk evaluated during boot steals
    // main-thread time from the screen the operator IS looking at.
    return idlePrefetch([notepadHostImport], { initialDelayMs: 4000 });
  }, []);

  if (!open) return null;

  return (
    <Suspense fallback={<NotepadShell />}>
      <NotepadOverlayHostLazy />
    </Suspense>
  );
}
