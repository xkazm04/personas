import { useState, useMemo, useCallback } from 'react';
import { X, DollarSign, RotateCcw, FileText } from 'lucide-react';
import type { PersonaGroup } from '@/lib/types/types';
import { UnsavedChangesModal } from '@/features/shared/components/overlays/UnsavedChangesModal';
import type { UnsavedGuardAction } from '@/hooks/utility/interaction/useUnsavedGuard';

interface WorkspaceSettingsProps {
  group: PersonaGroup;
  onUpdate: (updates: Partial<{
    description: string;
    defaultModelProfile: string;
    defaultMaxBudgetUsd: number;
    defaultMaxTurns: number;
    sharedInstructions: string;
  }>) => void;
  onClose: () => void;
}

export function WorkspaceSettings({ group, onUpdate, onClose }: WorkspaceSettingsProps) {
  const [description, setDescription] = useState(group.description ?? '');
  const [budget, setBudget] = useState(group.defaultMaxBudgetUsd?.toString() ?? '');
  const [turns, setTurns] = useState(group.defaultMaxTurns?.toString() ?? '');
  const [instructions, setInstructions] = useState(group.sharedInstructions ?? '');
  const [showGuard, setShowGuard] = useState(false);

  const isDirty = useMemo(() => {
    if (description.trim() !== (group.description ?? '')) return true;
    const bVal = budget.trim() ? parseFloat(budget) : undefined;
    if (bVal !== (group.defaultMaxBudgetUsd ?? undefined)) return true;
    const tVal = turns.trim() ? parseInt(turns, 10) : undefined;
    if (tVal !== (group.defaultMaxTurns ?? undefined)) return true;
    if (instructions.trim() !== (group.sharedInstructions ?? '')) return true;
    return false;
  }, [description, budget, turns, instructions, group]);

  const applyChanges = useCallback(() => {
    const updates: Record<string, string | number | undefined> = {};
    const newDesc = description.trim();
    if (newDesc !== (group.description ?? '')) updates.description = newDesc || undefined;
    const newBudget = budget.trim() ? parseFloat(budget) : undefined;
    if (newBudget !== (group.defaultMaxBudgetUsd ?? undefined)) updates.defaultMaxBudgetUsd = newBudget;
    const newTurns = turns.trim() ? parseInt(turns, 10) : undefined;
    if (newTurns !== (group.defaultMaxTurns ?? undefined)) updates.defaultMaxTurns = newTurns;
    const newInstructions = instructions.trim();
    if (newInstructions !== (group.sharedInstructions ?? '')) updates.sharedInstructions = newInstructions || undefined;

    if (Object.keys(updates).length > 0) {
      onUpdate(updates);
    }
  }, [description, budget, turns, instructions, group, onUpdate]);

  const handleSave = () => {
    applyChanges();
    onClose();
  };

  const handleCloseAttempt = () => {
    if (isDirty) {
      setShowGuard(true);
    } else {
      onClose();
    }
  };

  const handleGuardAction = (action: UnsavedGuardAction) => {
    setShowGuard(false);
    if (action === 'save') {
      applyChanges();
      onClose();
    } else if (action === 'discard') {
      onClose();
    }
    // 'stay' — just close the modal, keep editing
  };

  const inputClass = "w-full px-2 py-1 text-sm bg-background/60 border border-primary/20 rounded-xl outline-none focus-visible:border-primary/30 text-foreground/90 placeholder:text-muted-foreground/40";

  return (
    <div className="px-3 pb-3 pt-1 border-t border-primary/10 space-y-2.5" data-testid="workspace-settings-panel">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider">Workspace Defaults</span>
        <button onClick={handleCloseAttempt} className="p-0.5 hover:bg-secondary/60 rounded" data-testid="workspace-settings-close-btn">
          <X className="w-3 h-3 text-muted-foreground/60" />
        </button>
      </div>

      {/* Description */}
      <div>
        <label className="text-sm text-muted-foreground/50 flex items-center gap-1 mb-1">
          <FileText className="w-3 h-3" /> Description
        </label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Workspace purpose — e.g. Customer support agents, Finance automation team"
          className={inputClass}
          data-testid="workspace-description-input"
        />
      </div>

      {/* Budget + Turns row */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-sm text-muted-foreground/50 flex items-center gap-1 mb-1">
            <DollarSign className="w-3 h-3" /> Budget (USD)
          </label>
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="Budget in USD — e.g. 2.50"
            type="number"
            step="0.1"
            min="0"
            className={inputClass}
            data-testid="workspace-budget-input"
          />
        </div>
        <div className="flex-1">
          <label className="text-sm text-muted-foreground/50 flex items-center gap-1 mb-1">
            <RotateCcw className="w-3 h-3" /> Max Turns
          </label>
          <input
            value={turns}
            onChange={(e) => setTurns(e.target.value)}
            placeholder="Max round-trips — e.g. 25"
            type="number"
            step="1"
            min="1"
            className={inputClass}
            data-testid="workspace-turns-input"
          />
        </div>
      </div>

      {/* Shared Instructions */}
      <div>
        <label className="text-sm text-muted-foreground/50 flex items-center gap-1 mb-1">
          <FileText className="w-3 h-3" /> Shared Instructions
        </label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Instructions appended to all agents in this workspace — e.g. Always respond in formal English. Escalate billing issues to the finance team."
          rows={3}
          className={`${inputClass} resize-none`}
          data-testid="workspace-instructions-input"
        />
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="px-3 py-1 text-sm font-medium rounded-xl bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors"
          data-testid="workspace-settings-save-btn"
        >
          Save
        </button>
      </div>

      <UnsavedChangesModal
        isOpen={showGuard}
        onAction={handleGuardAction}
      />
    </div>
  );
}
