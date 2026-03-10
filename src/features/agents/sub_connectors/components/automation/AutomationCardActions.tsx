import { useState } from 'react';
import { Pencil, Pause, Play, Trash2, MoreHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PersonaAutomation } from '@/lib/bindings/PersonaAutomation';

interface AutomationCardActionsProps {
  automation: PersonaAutomation;
  onEdit: (id: string) => void;
  onToggleStatus: (id: string, newStatus: 'active' | 'paused') => void;
  onDelete: (id: string) => void;
}

export function AutomationCardActions({
  automation, onEdit, onToggleStatus, onDelete,
}: AutomationCardActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete(automation.id);
      setConfirmDelete(false);
      setMenuOpen(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 top-full mt-1 z-[100] w-40 rounded-lg border border-border bg-background shadow-lg py-1"
          >
            <button
              onClick={() => { onEdit(automation.id); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground/80 hover:bg-secondary/50"
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>

            {automation.deploymentStatus === 'active' && (
              <button
                onClick={() => { onToggleStatus(automation.id, 'paused'); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground/80 hover:bg-secondary/50"
              >
                <Pause className="w-3 h-3" /> Pause
              </button>
            )}

            {(automation.deploymentStatus === 'paused' || automation.deploymentStatus === 'draft') && (
              <button
                onClick={() => { onToggleStatus(automation.id, 'active'); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground/80 hover:bg-secondary/50"
              >
                <Play className="w-3 h-3" /> Activate
              </button>
            )}

            <div className="border-t border-border/40 my-1" />

            <button
              onClick={handleDelete}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-brand-rose hover:bg-brand-rose/10"
            >
              <Trash2 className="w-3 h-3" />
              {confirmDelete ? 'Confirm?' : 'Delete'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
