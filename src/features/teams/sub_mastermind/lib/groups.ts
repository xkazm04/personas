// Persisted user-drawn group rectangles (group draw mode). Prototype-stage
// persistence: localStorage, shared across canvas variants like positions.
import type { GroupRect } from './types';

const KEY = 'mastermind.groups.v1';

export function loadGroups(): GroupRect[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as GroupRect[]) : [];
  } catch {
    return [];
  }
}

export function saveGroups(groups: GroupRect[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(groups));
  } catch {
    // best-effort — a full/blocked storage never breaks the canvas
  }
}
