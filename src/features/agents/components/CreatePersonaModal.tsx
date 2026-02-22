import { useState } from 'react';
import { X, Bot, Sparkles, Terminal, Zap, Wrench, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
      <div className="w-full max-w-[780px] bg-background border border-primary/20 rounded-2xl shadow-2xl shadow-primary/5 overflow-hidden">
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

        <div className="flex">
          {/* Left: Form */}
          <div className="flex-1 px-5 py-4 space-y-4 min-w-0">
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

          {/* Right: Live Preview */}
          <div className="w-[260px] flex-shrink-0 border-l border-primary/10 bg-secondary/20 px-4 py-4 flex flex-col gap-4">
            <div className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-wider">Preview</div>

            {/* Miniature card preview — matches overview card styling */}
            <motion.div
              layout
              className="p-4 rounded-xl border border-primary/10 bg-secondary/30 relative overflow-hidden transition-all duration-300"
              style={{
                borderLeftWidth: 3,
                borderLeftColor: color,
              }}
            >
              {/* Subtle color wash */}
              <div
                className="absolute inset-0 transition-colors duration-300 pointer-events-none"
                style={{ backgroundColor: color, opacity: 0.04 }}
              />

              <div className="relative">
                <div className="flex items-center gap-3 mb-2">
                  <AnimatePresence mode="wait">
                    {icon ? (
                      icon.startsWith('http') ? (
                        <motion.img
                          key={icon}
                          src={icon}
                          alt=""
                          className="w-8 h-8"
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.8, opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                        />
                      ) : (
                        <motion.span
                          key={icon}
                          className="text-2xl"
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.8, opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                        >
                          {icon}
                        </motion.span>
                      )
                    ) : (
                      <motion.div
                        key="default-icon"
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-300"
                        style={{ backgroundColor: color + '20' }}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                      >
                        <Bot className="w-4 h-4 transition-colors duration-300" style={{ color }} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md text-emerald-400 bg-emerald-500/10">
                      Active
                    </span>
                  </div>
                </div>

                <h3 className="text-sm font-medium text-foreground/90 truncate">
                  {name.trim() || <span className="text-muted-foreground/25">Agent Name</span>}
                </h3>
                {(description.trim() || !name.trim()) && (
                  <p className="text-xs text-muted-foreground/50 mt-1 line-clamp-2">
                    {description.trim() || <span className="text-muted-foreground/20">Description will appear here</span>}
                  </p>
                )}

                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-primary/5 text-muted-foreground/40">
                    gpt-4o
                  </span>
                </div>
              </div>
            </motion.div>

            {/* What happens next */}
            <div className="mt-auto space-y-2">
              <div className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                What happens next
              </div>
              <div className="space-y-1.5">
                {[
                  { icon: Terminal, label: 'Write a system prompt' },
                  { icon: Zap, label: 'Add triggers & schedules' },
                  { icon: Wrench, label: 'Connect tools & APIs' },
                ].map((step) => (
                  <div key={step.label} className="flex items-center gap-2 text-[11px] text-muted-foreground/40">
                    <div className="w-5 h-5 rounded flex items-center justify-center bg-primary/5 border border-primary/10 flex-shrink-0">
                      <step.icon className="w-3 h-3 text-primary/40" />
                    </div>
                    {step.label}
                  </div>
                ))}
              </div>
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
