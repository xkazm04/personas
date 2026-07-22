// Persisted island positions (edit-mode drag). Prototype-stage persistence:
// localStorage keyed by project slug — shared by all canvas variants so a
// layout arranged in one variant carries over to the others.
export type PositionMap = Record<string, { x: number; y: number }>;

const KEY = 'mastermind.positions.v1';

export function loadPositions(): PositionMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PositionMap) : {};
  } catch {
    return {};
  }
}

export function savePositions(p: PositionMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // best-effort — a full/blocked storage never breaks the canvas
  }
}
