export { default as MemoriesPage } from './components/MemoriesPage';
export { MemoryConflictReview } from './components/MemoryConflictReview';
export { MemoryRow, ImportanceBar, ImportanceDots } from './components/MemoryCard';
export { InlineAddMemoryForm } from './components/CreateMemoryForm';
export { MemoryActionsPanel } from './components/MemoryActionCard';
export { MemoryFilterBar } from './components/MemoryFilterBar';
export type { MemoryFilterBarProps } from './components/MemoryFilterBar';
export { default as ReviewResultsModal } from './components/ReviewResultsModal';
export { default as ConflictCard } from './components/ConflictCard';

// libs
export { detectConflicts, textSimilarity } from './libs/memoryConflicts';
export type { MemoryConflict, ConflictKind, ConflictResolution } from './libs/memoryConflicts';
export { loadActions, saveActions, extractActionsFromReview, ACTION_KIND_META } from './libs/memoryActions';
export type { MemoryAction, MemoryActionKind } from './libs/memoryActions';
export { KIND_CONFIG, kindBadge, similarityBadge, mergeMemories } from './libs/conflictHelpers';
