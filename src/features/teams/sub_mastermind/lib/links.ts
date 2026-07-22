// Persisted user-drawn project connections (connect tool). Prototype-stage
// persistence: localStorage, shared across canvas variants like positions.
import type { UserLink } from './types';

const KEY = 'mastermind.links.v1';

/** The short palette offered by the link editor — theme tokens first. */
export const LINK_PALETTE = [
  'var(--primary)',
  'var(--accent)',
  'var(--status-success)',
  'var(--status-warning)',
  'var(--status-error)',
  '#a78bfa',
] as const;

export function loadLinks(): UserLink[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as UserLink[]) : [];
  } catch {
    return [];
  }
}

export function saveLinks(links: UserLink[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(links));
  } catch {
    // best-effort — a full/blocked storage never breaks the canvas
  }
}
