import { Suspense, useEffect } from 'react';

import { lazyRetry } from '@/lib/lazyRetry';

import { useSystemStore } from '@/stores/systemStore';

import { startNotepadListeners } from './notepadStore';

// The overlay pulls in the editor, the markdown renderer, the project
// dropdown and three body variants. None of that belongs in the app-boot
// graph — the FOOTER only needs to know whether the overlay is raised.
const NotepadOverlayHost = lazyRetry(() => import('./NotepadOverlayHost'));

/**
 * App-wide host for the notepad overlay.
 *
 * Same shape as `FleetGridLayer`, and for the same reason: the notepad is a
 * LAYER, not a page. Raising it from the footer over whatever you were looking
 * at means jotting something down never costs a navigation, and closing it
 * puts you back exactly where you were because you never left.
 *
 * This component is deliberately cheap. It owns the open/closed gate and the
 * one always-on side effect the feature needs (the sweeper listener, which
 * must run whether or not the overlay has ever been opened — a note published
 * yesterday can complete while the notepad is shut).
 */
export default function NotepadLayer() {
  const open = useSystemStore((s) => s.notepadOpen);

  useEffect(() => {
    startNotepadListeners();
  }, []);

  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <NotepadOverlayHost />
    </Suspense>
  );
}
