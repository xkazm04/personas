// Island positions (edit-mode drag). Persistence now lives in the durable
// layout store (one versioned DB document) — this module stays as the stable
// import surface for callers. See `layoutStore.ts` for the lifecycle.
export type { PositionMap } from './layoutStore';
export { loadPositions, savePositions } from './layoutStore';
