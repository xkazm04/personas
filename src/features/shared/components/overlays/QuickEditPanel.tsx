import { useState, useRef, useEffect, useCallback } from 'react';
import { Save, X } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { Persona } from '@/lib/bindings/Persona';

interface QuickEditPanelProps {
  persona: Persona;
  onSave: (id: string, updates: { description?: string; model?: string }) => void;
  onCancel: () => void;
}

/** Parse the model name out of a model_profile JSON string. */
function parseModelName(json: string | null | undefined): string {
  if (!json) return '';
  try {
    const parsed = JSON.parse(json);
    return parsed.model ?? '';
  } catch {
    return '';
  }
}

export function QuickEditPanel({ persona, onSave, onCancel }: QuickEditPanelProps) {
  const [description, setDescription] = useState(persona.description ?? '');
  const [model, setModel] = useState(() => parseModelName(persona.model_profile));
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => descRef.current?.focus());
  }, []);

  const handleSave = useCallback(() => {
    const updates: { description?: string; model?: string } = {};
    const origDesc = persona.description ?? '';
    const origModel = parseModelName(persona.model_profile);

    if (description.trim() !== origDesc) updates.description = description.trim();
    if (model.trim() !== origModel) updates.model = model.trim();

    if (Object.keys(updates).length > 0) {
      onSave(persona.id, updates);
    } else {
      onCancel();
    }
  }, [description, model, persona, onSave, onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  }, [onCancel, handleSave]);

  return (
    <div className="px-4 py-3 space-y-3" onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <PersonaIcon icon={persona.icon} color={persona.color} size="w-4 h-4" className="shrink-0" frameSize={"lg"} />
        <span className="typo-body font-medium text-foreground truncate">{persona.name}</span>
        <span className="typo-caption text-muted-foreground/60">Quick Edit</span>
      </div>

      {/* Description */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Description
        </label>
        <textarea
          ref={descRef}
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-lg bg-secondary/30 border border-primary/10 px-3 py-2 typo-body text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-violet-400/50 resize-none transition-colors"
          placeholder="Agent description..."
        />
      </div>

      {/* Model */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Model
        </label>
        <input
          value={model}
          onChange={e => setModel(e.target.value)}
          className="w-full rounded-lg bg-secondary/30 border border-primary/10 px-3 py-2 typo-body text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-violet-400/50 transition-colors"
          placeholder="e.g. claude-sonnet-4-20250514"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <span className="typo-caption text-muted-foreground/50">
          <kbd className="px-1 py-0.5 bg-secondary/50 border border-primary/10 rounded text-[10px]">Ctrl+Enter</kbd>
          {' '}save
          <span className="mx-2">·</span>
          <kbd className="px-1 py-0.5 bg-secondary/50 border border-primary/10 rounded text-[10px]">Esc</kbd>
          {' '}cancel
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption text-muted-foreground/70 hover:bg-secondary/40 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption text-foreground bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/30 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
