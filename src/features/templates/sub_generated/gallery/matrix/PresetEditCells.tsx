/**
 * Preset edit cells — Review, Memory, and Messages cells for PersonaMatrix edit mode.
 */
import { useMemo, useCallback } from 'react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { MatrixEditState, MatrixEditCallbacks } from './matrixEditTypes';
import { REVIEW_PRESETS, MEMORY_PRESETS, MESSAGE_PRESETS } from './matrixEditTypes';

// ── Review preset cell (edit mode) ────────────────────────────────────

interface ReviewEditCellProps {
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
}

export function ReviewEditCell({ editState, callbacks }: ReviewEditCellProps) {
  // Derive current preset from state
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

  const active = editState.requireApproval;
  const dotColor = active ? 'bg-violet-400' : 'bg-emerald-400';

  return (
    <div className="space-y-2 w-full">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} />
        <span className="text-sm font-medium text-foreground/80">
          {REVIEW_PRESETS.find((p) => p.value === currentPreset)?.label ?? 'Custom'}
        </span>
      </div>
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

// ── Memory preset cell (edit mode) ────────────────────────────────────

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

  const active = editState.memoryEnabled;
  const dotColor = active ? 'bg-purple-400' : 'bg-zinc-500';

  return (
    <div className="space-y-2 w-full">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} />
        <span className="text-sm font-medium text-foreground/80">
          {MEMORY_PRESETS.find((p) => p.value === currentPreset)?.label ?? 'Custom'}
        </span>
      </div>
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

// ── Messages preset cell (edit mode) ──────────────────────────────────

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
    <div className="space-y-2 w-full">
      <span className="text-sm font-medium text-foreground/80">
        {MESSAGE_PRESETS.find((p) => p.value === currentPreset)?.label ?? 'Custom'}
      </span>
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
