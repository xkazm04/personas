import { useState } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { IconSelector } from '@/features/shared/components/IconSelector';

const COLOR_PRESETS = [
  '#EA4335', '#4A154B', '#24292e', '#3B82F6',
  '#8b5cf6', '#10b981', '#f59e0b', '#ec4899',
];

interface CreatePersonaModalProps {
  open: boolean;
  onClose: () => void;
}

export default function CreatePersonaModal({ open, onClose }: CreatePersonaModalProps) {
  const createPersona = usePersonaStore((s) => s.createPersona);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const movePersonaToGroup = usePersonaStore((s) => s.movePersonaToGroup);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const groups = usePersonaStore((s) => s.groups);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('#8b5cf6');
  const [groupId, setGroupId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  if (!open) return null;

  const isValid = name.trim().length >= 2;

  const handleSubmit = async () => {
    if (!isValid || isCreating) return;
    setIsCreating(true);
    try {
      const p = await createPersona({
        name: name.trim(),
        description: description.trim() || undefined,
        system_prompt: 'You are a helpful AI assistant.',
        icon: icon || undefined,
        color,
      });
      if (groupId) {
        await movePersonaToGroup(p.id, groupId);
      }
      selectPersona(p.id);
      onClose();
      // Reset form
      setName('');
      setDescription('');
      setIcon('');
      setColor('#8b5cf6');
      setGroupId('');
    } catch {
      /* handled in store */
    } finally {
      setIsCreating(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-secondary/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg bg-background border border-primary/20 rounded-2xl shadow-2xl shadow-primary/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-primary/10 bg-secondary/40">
          <h2 className="text-base font-semibold text-foreground">New Persona</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-secondary/60 text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Icon Selection */}
          <div>
            <label className="block text-sm font-medium text-foreground/60 mb-2">Icon</label>
            <IconSelector value={icon} onChange={setIcon} connectors={connectorDefinitions} size="md" />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-foreground/60 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Agent"
              className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              autoFocus
            />
            {name.length > 0 && name.trim().length < 2 && (
              <p className="text-xs text-red-400/70 mt-1">Name must be at least 2 characters</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground/60 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this persona do?"
              rows={2}
              className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-none"
            />
          </div>

          {/* Group */}
          {groups.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-foreground/60 mb-1">Group</label>
              <div className="relative">
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="w-full appearance-none px-3 py-2 pr-8 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                >
                  <option value="">No group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
              </div>
            </div>
          )}

          {/* Color */}
          <div>
            <label className="block text-sm font-medium text-foreground/60 mb-2">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => {
                const isSelected = color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      isSelected
                        ? 'border-white scale-110 ring-2 ring-primary/30'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10 bg-secondary/30">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground/60 hover:text-foreground rounded-lg hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || isCreating}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              isValid && !isCreating
                ? 'bg-gradient-to-r from-primary to-accent text-foreground shadow-lg shadow-primary/20 hover:from-primary/90 hover:to-accent/90'
                : 'bg-secondary/40 text-muted-foreground/30 cursor-not-allowed'
            }`}
          >
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
