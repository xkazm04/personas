/**
 * loadError - why the live blueprint could not open, as one of three states
 * (spark one-control, WP3): the store could not be read, lens-scan is not
 * installed for the product (no registry), or node is not on PATH.
 *
 * Read from the structured `AppError` the doors reject with (`kind`), never
 * from a translated string. `process_spawn` is only ever the node check
 * (`lens_scan/tooling.rs require_node`); a `not_found` names the lens-scan
 * scripts when the registry is missing (`locate_scripts`, whose message
 * starts "lens-scan not found"), and the product root or store otherwise;
 * everything else is the store itself.
 *
 * React-free.
 */
import { isTauriError } from '@/lib/types/tauriError';

export type LoadErrorKind = 'store' | 'registry' | 'node';

export function loadErrorKind(err: unknown): LoadErrorKind {
  if (!isTauriError(err)) return 'store';
  if (err.kind === 'process_spawn') return 'node';
  // Invariant: `locate_scripts` is the one NotFound that names lens-scan itself.
  if (err.kind === 'not_found' && err.error.startsWith('lens-scan not found')) return 'registry';
  return 'store';
}
