import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, AlertTriangle } from 'lucide-react';
import { TEAM_ROLES, PersonaAvatar } from '@/features/pipeline/sub_canvas/teamConstants';

interface TeamConfigPanelProps {
  member: {
    id: string;
    persona_name?: string;
    name?: string;
    persona_icon?: string;
    icon?: string;
    persona_color?: string;
    color?: string;
    role?: string;
  };
  onClose: () => void;
  onRoleChange: (memberId: string, role: string) => void;
  onRemove: (memberId: string) => void;
}

export default function TeamConfigPanel({ member, onClose, onRoleChange, onRemove }: TeamConfigPanelProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Auto-revert confirm state after 3 seconds
  useEffect(() => {
    if (!confirmRemove) return;
    const timer = setTimeout(() => setConfirmRemove(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmRemove]);

  if (!member) return null;

  const personaName = member.persona_name || member.name || 'Agent';
  const personaIcon = member.persona_icon || member.icon || '';
  const personaColor = member.persona_color || member.color || '#6366f1';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: 300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 300, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="absolute top-0 right-0 bottom-0 w-72 bg-background/95 backdrop-blur-md border-l border-primary/15 z-20 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
          <span className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">Configure</span>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-secondary/60 text-muted-foreground/90 hover:text-foreground/95 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Persona Info */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/40 border border-primary/10">
            <PersonaAvatar icon={personaIcon} color={personaColor} size="lg" />
            <div>
              <div className="text-sm font-semibold text-foreground/90">{personaName}</div>
              <div className="text-sm text-muted-foreground/90">Member ID: {member.id?.slice(0, 8)}...</div>
            </div>
          </div>

          {/* Role Selector */}
          <div>
            <label className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider mb-2 block">
              Role
            </label>
            <div className="space-y-1.5">
              {TEAM_ROLES.map((role) => (
                <button
                  key={role.value}
                  onClick={() => onRoleChange(member.id, role.value)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                    member.role === role.value
                      ? 'bg-indigo-500/10 border-indigo-500/25'
                      : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50'
                  }`}
                >
                  <div className={`text-sm font-medium ${member.role === role.value ? 'text-indigo-300' : 'text-foreground/90'}`}>
                    {role.label}
                  </div>
                  <div className="text-sm text-muted-foreground/80 mt-0.5">{role.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-primary/10">
          <AnimatePresence mode="wait">
            {confirmRemove ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-2"
              >
                <div className="flex items-center gap-2 text-sm text-amber-400/70">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Remove "{personaName}" from team?
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onRemove(member.id);
                      onClose();
                    }}
                    className="flex-1 px-3 py-1.5 text-sm font-medium rounded-lg bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmRemove(false)}
                    className="flex-1 px-3 py-1.5 text-sm font-medium rounded-lg bg-secondary/50 text-muted-foreground/80 hover:text-foreground/95 hover:bg-secondary/70 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.button
                key="remove"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                onClick={() => setConfirmRemove(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/15 text-sm font-medium transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove from Team
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
