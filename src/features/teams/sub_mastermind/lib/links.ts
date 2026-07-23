// User-drawn project connections (connect tool). Persistence now lives in the
// durable layout store (one versioned DB document); this module keeps the link
// palette and the stable load/save import surface for callers.
export { loadLinks, saveLinks } from './layoutStore';

/** The short palette offered by the link editor — theme tokens first. */
export const LINK_PALETTE = [
  'var(--primary)',
  'var(--accent)',
  'var(--status-success)',
  'var(--status-warning)',
  'var(--status-error)',
  '#a78bfa',
] as const;
