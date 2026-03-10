/**
 * EditableMatrixCells — re-exports for interactive cell renderers used by PersonaMatrix edit mode.
 *
 * Split into:
 * - matrixEditTypes.ts — types, presets, and constants
 * - ConnectorEditCell.tsx — connector credential selection
 * - TriggerEditCell.tsx — trigger configuration
 * - PresetEditCells.tsx — review, memory, and messages preset cells
 */

// Types & constants
export type { MatrixEditState, MatrixEditCallbacks } from './matrixEditTypes';
export { REVIEW_PRESETS, MEMORY_PRESETS, MESSAGE_PRESETS, TRIGGER_ICONS } from './matrixEditTypes';

// Cell components
export { ConnectorEditCell } from './ConnectorEditCell';
export { TriggerEditCell } from './TriggerEditCell';
export { ReviewEditCell, MemoryEditCell, MessagesEditCell } from './PresetEditCells';
