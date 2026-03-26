/** Shared grid constants and utilities for all canvas implementations. */

export const GRID_SIZE = 24;

export function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}
