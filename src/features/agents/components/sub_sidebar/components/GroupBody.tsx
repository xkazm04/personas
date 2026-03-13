import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, DollarSign, RotateCcw, FileText } from 'lucide-react';
import { DraggablePersonaCard } from './DraggablePersonaCard';
import type { Persona, PersonaGroup } from '@/lib/types/types';

// -- Workspace Settings sub-component --------------------------------
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

  const handleSave = () => {
    const updates: Record<string, string | number | undefined> = {};
    const newDesc = description.trim();
    if (newDesc !== (group.description ?? '')) updates.description = newDesc || undefined;
    const newBudget = budget.trim() ? parseFloat(budget) : undefined;
    if (newBudget !== (group.defaultMaxBudgetUsd ?? undefined)) updates.defaultMaxBudgetUsd = newBudget;
    const newTurns = turns.trim() ? parseInt(turns, 10) : undefined;
    if (newTurns !== (group.defaultMaxTurns ?? undefined)) updates.defaultMaxTurns = newTurns;
    const newInstructions = instructions.trim();
    if (newInstructions !== (group.sharedInstructions ?? '')) updates.sharedInstructions = newInstructions || undefined;

    if (Object.keys(updates).length > 0) onUpdate(updates);
    onClose();
  };

  const inputClass = "w-full px-2 py-1 text-sm bg-background/60 border border-primary/20 rounded-xl outline-none focus:border-primary/30 text-foreground/90 placeholder:text-muted-foreground/40";

  return (
    <div className="px-3 pb-3 pt-1 border-t border-primary/10 space-y-2.5" data-testid="workspace-settings-panel">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider">Workspace Defaults</span>
        <button onClick={onClose} className="p-0.5 hover:bg-secondary/60 rounded" data-testid="workspace-settings-close-btn">
          <X className="w-3 h-3 text-muted-foreground/60" />
        </button>
      </div>
      <div>
        <label className="text-sm text-muted-foreground/50 flex items-center gap-1 mb-1">
          <FileText className="w-3 h-3" /> Description
        </label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Workspace purpose..." className={inputClass} data-testid="workspace-description-input" />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-sm text-muted-foreground/50 flex items-center gap-1 mb-1">
            <DollarSign className="w-3 h-3" /> Budget (USD)
          </label>
          <input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 2.50" type="number" step="0.1" min="0" className={inputClass} data-testid="workspace-budget-input" />
        </div>
        <div className="flex-1">
          <label className="text-sm text-muted-foreground/50 flex items-center gap-1 mb-1">
            <RotateCcw className="w-3 h-3" /> Max Turns
          </label>
          <input value={turns} onChange={(e) => setTurns(e.target.value)} placeholder="e.g. 25" type="number" step="1" min="1" className={inputClass} data-testid="workspace-turns-input" />
        </div>
      </div>
      <div>
        <label className="text-sm text-muted-foreground/50 flex items-center gap-1 mb-1">
          <FileText className="w-3 h-3" /> Shared Instructions
        </label>
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Instructions appended to all agents in this workspace..." rows={3} className={`${inputClass} resize-none`} data-testid="workspace-instructions-input" />
      </div>
      <div className="flex justify-end">
        <button onClick={handleSave} className="px-3 py-1 text-sm font-medium rounded-xl bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors" data-testid="workspace-settings-save-btn">
          Save
        </button>
      </div>
    </div>
  );
}

// -- Persona List -----------------------------------------------------

interface PersonaListProps {
  personas: Persona[];
  selectedPersonaId: string | null;
  isCollapsed: boolean;
  onSelectPersona: (id: string) => void;
  onPersonaContextMenu?: (e: React.MouseEvent, persona: Persona) => void;
}

export function PersonaList({ personas, selectedPersonaId, isCollapsed, onSelectPersona, onPersonaContextMenu }: PersonaListProps) {
  return (
    <AnimatePresence initial={false}>
      {!isCollapsed && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="px-1.5 pb-1.5">
            {personas.length === 0 && (
              <div className="text-center py-3 text-sm text-muted-foreground/80">
                Drop agents here
              </div>
            )}
            {personas.map((persona) => (
              <DraggablePersonaCard
                key={persona.id}
                persona={persona}
                isSelected={selectedPersonaId === persona.id}
                onClick={() => onSelectPersona(persona.id)}
                onContextMenu={onPersonaContextMenu ? (e) => onPersonaContextMenu(e, persona) : undefined}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
