// User-drawn group rectangles (group draw mode). Persistence now lives in the
// durable layout store (one versioned DB document); this module stays as the
// stable import surface for callers.
export { loadGroups, saveGroups } from './layoutStore';
