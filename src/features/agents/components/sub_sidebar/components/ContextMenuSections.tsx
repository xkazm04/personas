import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Copy, Power, PowerOff, Trash2, ChevronRight, Check, AlertTriangle, Share2 } from 'lucide-react';
import type { DbPersona } from '@/lib/types/types';
import { QUICK_MODELS, currentModelValue } from './ContextMenuActions';

// ── Model Submenu ─────────────────────────────────────────────────────

interface ModelSubmenuProps {
  persona: DbPersona;
  subMenuRef: React.RefObject<HTMLDivElement | null>;
  subPos: { left: number; top: number } | null;
  showModelSub: boolean;
  setShowModelSub: (v: boolean) => void;
  onModelSwitch: (value: string) => void;
}

export function ModelSubmenu({ persona, subMenuRef, subPos, showModelSub, setShowModelSub, onModelSwitch }: ModelSubmenuProps) {
  const activeModel = currentModelValue(persona);

  return (
    <AnimatePresence>
      {showModelSub && subPos && (
        <motion.div
          ref={subMenuRef}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.1 }}
          onMouseEnter={() => setShowModelSub(true)}
          onMouseLeave={() => setShowModelSub(false)}
          className="fixed z-101 w-48 py-1 bg-background/95 backdrop-blur-md border border-primary/20 rounded-lg shadow-xl"
          style={{ left: subPos.left, top: subPos.top }}
          role="menu"
          aria-label="Quick model selection"
          data-menu-scope="sub"
        >
          {QUICK_MODELS.map((model, i) => {
            const isActive = activeModel === model.value;
            const prevProvider = i > 0 ? QUICK_MODELS[i - 1]!.provider : null;
            const showDivider = prevProvider !== null && prevProvider !== model.provider;

            return (
              <div key={model.value || '__opus__'}>
                {showDivider && <div className="my-1 border-t border-primary/10" />}
                <button
                  onClick={() => onModelSwitch(model.value)}
                  className={`w-full px-3 py-1.5 text-sm text-left flex items-center gap-2 transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-foreground/90'
                      : 'hover:bg-secondary/60 text-foreground/80'
                  }`}
                  role="menuitem"
                  data-menuitem="true"
                >
                  {isActive ? (
                    <Check className="w-3 h-3 text-primary shrink-0" />
                  ) : (
                    <span className="w-3 h-3 shrink-0" />
                  )}
                  <span className="flex-1 truncate">{model.label}</span>
                  <span className="text-sm text-muted-foreground/50">{model.provider}</span>
                </button>
              </div>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Menu Item Sections ────────────────────────────────────────────────

interface MenuItemsProps {
  persona: DbPersona;
  modelItemRef: React.RefObject<HTMLButtonElement | null>;
  showModelSub: boolean;
  setShowModelSub: (v: boolean | ((v: boolean) => boolean)) => void;
  confirmDelete: boolean;
  onToggleEnabled: () => void;
  onDuplicate: () => void;
  onExportPersona: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
}

export function MenuItems({
  persona, modelItemRef, showModelSub, setShowModelSub,
  confirmDelete, onToggleEnabled, onDuplicate, onExportPersona, onDelete, onCancelDelete,
}: MenuItemsProps) {
  return (
    <>
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-primary/10">
        <span className="text-sm font-medium text-foreground/70 truncate block">{persona.name}</span>
      </div>

      {/* Model Switch */}
      <button
        ref={modelItemRef}
        onMouseEnter={() => setShowModelSub(true)}
        onMouseLeave={() => setShowModelSub(false)}
        onClick={() => setShowModelSub((v: boolean) => !v)}
        className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/60 flex items-center gap-2 text-foreground/90 relative"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={showModelSub}
        data-menuitem="true"
      >
        <Cpu className="w-3.5 h-3.5 text-muted-foreground/80" />
        <span className="flex-1">Model</span>
        <ChevronRight className="w-3 h-3 text-muted-foreground/60" />
      </button>

      {/* Enable / Disable */}
      <button
        onClick={onToggleEnabled}
        className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/60 flex items-center gap-2 text-foreground/90"
        role="menuitem"
        data-menuitem="true"
      >
        {persona.enabled ? (
          <>
            <PowerOff className="w-3.5 h-3.5 text-amber-400/80" />
            <span>Disable</span>
          </>
        ) : (
          <>
            <Power className="w-3.5 h-3.5 text-emerald-400/80" />
            <span>Enable</span>
          </>
        )}
      </button>

      {/* Duplicate */}
      <button
        onClick={onDuplicate}
        className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/60 flex items-center gap-2 text-foreground/90"
        role="menuitem"
        data-menuitem="true"
      >
        <Copy className="w-3.5 h-3.5 text-muted-foreground/80" />
        <span>Duplicate</span>
      </button>

      {/* Export as .persona */}
      <button
        onClick={onExportPersona}
        className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/60 flex items-center gap-2 text-foreground/90"
        role="menuitem"
        data-menuitem="true"
      >
        <Share2 className="w-3.5 h-3.5 text-muted-foreground/80" />
        <span>Export .persona</span>
      </button>

      {/* Separator */}
      <div className="my-1 border-t border-primary/10" />

      {/* Delete */}
      {!confirmDelete ? (
        <button
          onClick={onDelete}
          className="w-full px-3 py-1.5 text-sm text-left hover:bg-red-500/10 flex items-center gap-2 text-red-400/80 hover:text-red-400"
          role="menuitem"
          data-menuitem="true"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete</span>
        </button>
      ) : (
        <div className="px-2 py-1.5 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
          <span className="text-sm text-amber-400/80 shrink-0">Sure?</span>
          <button
            onClick={onDelete}
            className="flex-1 px-2 py-0.5 bg-red-500 hover:bg-red-600 text-foreground rounded text-sm font-medium transition-colors"
            role="menuitem"
            data-menuitem="true"
          >
            Delete
          </button>
          <button
            onClick={onCancelDelete}
            className="px-2 py-0.5 bg-secondary/50 text-foreground/80 rounded text-sm transition-colors hover:bg-secondary/70"
            role="menuitem"
            data-menuitem="true"
          >
            No
          </button>
        </div>
      )}
    </>
  );
}
