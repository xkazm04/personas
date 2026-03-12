/**
 * Preset edit cells -- Review, Memory, Messages, Error Strategy, and Use Case cells
 * for PersonaMatrix edit mode.
 *
 * Each cell shows only a ThemedSelect dropdown or inline list -- the dimension label
 * is already rendered by the cell header, so we avoid duplicating the selected value.
 */
import { useState, useMemo, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { MatrixEditState, MatrixEditCallbacks } from './matrixEditTypes';
import { REVIEW_PRESETS, MEMORY_PRESETS, MESSAGE_PRESETS } from './matrixEditTypes';

const ERROR_STRATEGY_OPTIONS = [
  { value: 'halt', label: 'Halt on error' },
  { value: 'retry-once', label: 'Retry once' },
  { value: 'retry-3x', label: 'Retry 3x' },
  { value: 'notify-and-continue', label: 'Notify & continue' },
  { value: 'skip', label: 'Skip failed step' },
] as const;

// -- Review preset cell (edit mode) ------------------------------------

interface ReviewEditCellProps {
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
}

export function ReviewEditCell({ editState, callbacks }: ReviewEditCellProps) {
  const currentPreset = useMemo(() => {
    if (!editState.requireApproval) return 'autonomous';
    const match = REVIEW_PRESETS.find(
      (p) =>
        p.approval === editState.requireApproval &&
        p.severity === (editState.autoApproveSeverity || '') &&
        p.timeout === (editState.reviewTimeout || '24h'),
    );
    return match?.value ?? 'balanced';
  }, [editState.requireApproval, editState.autoApproveSeverity, editState.reviewTimeout]);

  const handlePresetChange = useCallback(
    (value: string) => {
      const preset = REVIEW_PRESETS.find((p) => p.value === value);
      if (!preset) return;
      callbacks.onToggleApproval(preset.approval);
      callbacks.onPreferenceChange('autoApproveSeverity', preset.severity);
      callbacks.onPreferenceChange('reviewTimeout', preset.timeout);
    },
    [callbacks],
  );

  return (
    <div className="w-full">
      <ThemedSelect
        filterable
        value={currentPreset}
        onValueChange={handlePresetChange}
        options={REVIEW_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        placeholder="Select review policy..."
        className="!py-1.5 !px-2.5 !text-sm !rounded-lg"
      />
    </div>
  );
}

// -- Memory preset cell (edit mode) ------------------------------------

interface MemoryEditCellProps {
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
}

export function MemoryEditCell({ editState, callbacks }: MemoryEditCellProps) {
  const currentPreset = useMemo(() => {
    if (!editState.memoryEnabled) return 'stateless';
    const scope = editState.memoryScope || 'all';
    const match = MEMORY_PRESETS.find((p) => p.enabled && p.scope === scope);
    return match?.value ?? 'full';
  }, [editState.memoryEnabled, editState.memoryScope]);

  const handlePresetChange = useCallback(
    (value: string) => {
      const preset = MEMORY_PRESETS.find((p) => p.value === value);
      if (!preset) return;
      callbacks.onToggleMemory(preset.enabled);
      callbacks.onPreferenceChange('memoryScope', preset.scope);
    },
    [callbacks],
  );

  return (
    <div className="w-full">
      <ThemedSelect
        filterable
        value={currentPreset}
        onValueChange={handlePresetChange}
        options={MEMORY_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        placeholder="Select memory strategy..."
        className="!py-1.5 !px-2.5 !text-sm !rounded-lg"
      />
    </div>
  );
}

// -- Messages preset cell (edit mode) ----------------------------------

interface MessagesEditCellProps {
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
}

export function MessagesEditCell({ editState, callbacks }: MessagesEditCellProps) {
  const currentPreset = editState.messagePreset || 'updates';

  const handlePresetChange = useCallback(
    (value: string) => {
      callbacks.onPreferenceChange('messagePreset', value);
    },
    [callbacks],
  );

  return (
    <div className="w-full">
      <ThemedSelect
        filterable
        value={currentPreset}
        onValueChange={handlePresetChange}
        options={MESSAGE_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        placeholder="Notification strategy..."
        className="!py-1.5 !px-2.5 !text-sm !rounded-lg"
      />
    </div>
  );
}

// -- Error strategy cell (edit mode) ----------------------------------

interface ErrorEditCellProps {
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
}

export function ErrorEditCell({ editState, callbacks }: ErrorEditCellProps) {
  const current = editState.errorStrategy || 'halt';

  const handleChange = useCallback(
    (value: string) => {
      callbacks.onErrorStrategyChange?.(value);
    },
    [callbacks],
  );

  return (
    <div className="w-full">
      <ThemedSelect
        filterable
        value={current}
        onValueChange={handleChange}
        options={ERROR_STRATEGY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        placeholder="Error handling..."
        className="!py-1.5 !px-2.5 !text-sm !rounded-lg"
      />
    </div>
  );
}

// -- Use case cell (edit mode) ----------------------------------------

interface UseCaseEditCellProps {
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
}

export function UseCaseEditCell({ editState, callbacks }: UseCaseEditCellProps) {
  const [newTitle, setNewTitle] = useState('');
  const useCases = editState.useCases ?? [];

  const handleAdd = useCallback(() => {
    const title = newTitle.trim();
    if (!title || !callbacks.onUseCaseAdd) return;
    callbacks.onUseCaseAdd(title);
    setNewTitle('');
  }, [newTitle, callbacks]);

  return (
    <div className="w-full space-y-1.5">
      {useCases.slice(0, 3).map((uc) => (
        <div key={uc.id} className="flex items-center gap-1.5 group">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400/50 flex-shrink-0" />
          <span className="text-sm text-foreground/70 leading-snug flex-1 truncate">{uc.title}</span>
          {callbacks.onUseCaseRemove && (
            <button type="button" onClick={() => callbacks.onUseCaseRemove!(uc.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-foreground/5 transition-all">
              <X className="w-3 h-3 text-muted-foreground/40" />
            </button>
          )}
        </div>
      ))}
      {useCases.length > 3 && (
        <span className="text-xs text-muted-foreground/40 pl-3">+{useCases.length - 3} more</span>
      )}
      {callbacks.onUseCaseAdd && (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="Add use case..."
            className="flex-1 px-2 py-1 rounded-md border border-primary/10 bg-transparent text-sm text-foreground/70 placeholder-muted-foreground/30 focus:outline-none focus:border-primary/25 transition-colors"
          />
          <button type="button" onClick={handleAdd} disabled={!newTitle.trim()}
            className="p-1 rounded-md text-primary/60 hover:text-primary hover:bg-primary/10 disabled:text-muted-foreground/20 transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
