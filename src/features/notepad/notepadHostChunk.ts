// The notepad overlay's chunk, in ONE place — because a prefetch only helps if
// it warms the exact module the lazy component will later ask for.
//
// Vite keys a dynamic import by its literal specifier, so `import('./X')`
// written in two files produces two call sites but one module record; what a
// second literal WOULD cost is the discipline of keeping them identical
// forever. Naming the thunk once removes that class of drift: the footer's
// hover prefetch, the layer's idle prefetch and the lazy component provably
// warm and consume the same record.
import { lazyRetry } from '@/lib/lazyRetry';
import { silentCatch } from '@/lib/silentCatch';

/** The one import specifier for the overlay host. */
const importHost = () => import('./NotepadOverlayHost');

/** What `NotepadLayer` renders once the pad is raised. */
export const NotepadOverlayHostLazy = lazyRetry(importHost);

/**
 * Fetch + parse + evaluate the overlay chunk now, mounting nothing.
 *
 * Idempotent by construction: the module record is cached after the first
 * call, so hovering the footer icon ten times costs one import. Failures are
 * swallowed — a missed prefetch is not a defect, it is just a cold open, and
 * `lazyRetry` will surface any real error when the component actually mounts.
 */
export function prefetchNotepadHost(): void {
  void importHost().catch(silentCatch('notepad host prefetch'));
}

/** The thunk itself, for `idlePrefetch`'s serialized queue. */
export const notepadHostImport = importHost;
