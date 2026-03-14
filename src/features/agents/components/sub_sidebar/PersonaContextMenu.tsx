import { useState, useRef, useCallback, useEffect } from 'react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useViewportClampFixed } from '@/hooks/utility/interaction/useViewportClamp';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Copy, Power, PowerOff, Trash2, ChevronRight } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { useToastStore } from '@/stores/toastStore';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { BlastRadiusPanel, useBlastRadius } from '@/features/shared/components/display/BlastRadiusPanel';
import { getPersonaBlastRadius } from '@/api/agents/personas';
import type { Persona } from '@/lib/types/types';
import { quickModelToProfile, currentModelValue } from './quickModelUtils';
import { ModelSubmenu } from './ModelSubmenu';

// -- Context Menu Component --------------------------------------------

export interface ContextMenuState {
  persona: Persona;
  x: number;
  y: number;
}

interface PersonaContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
}

export function PersonaContextMenu({ state, onClose }: PersonaContextMenuProps) {
  const { persona, x, y } = state;
  const menuRef = useRef<HTMLDivElement>(null);
  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);
  const duplicatePersona = useAgentStore((s) => s.duplicatePersona);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const deletePersona = useAgentStore((s) => s.deletePersona);
  const addToast = useToastStore((s) => s.addToast);

  const [showModelSub, setShowModelSub] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const modelItemRef = useRef<HTMLButtonElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);

  const { items: blastItems, loading: blastLoading } = useBlastRadius(
    () => getPersonaBlastRadius(persona.id),
    showDeleteModal,
  );

  const getMainItems = useCallback(() => {
    if (!menuRef.current) return [] as HTMLButtonElement[];
    return Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('button[data-menuitem="true"]'));
  }, []);

  const getSubItems = useCallback(() => {
    if (!subMenuRef.current) return [] as HTMLButtonElement[];
    return Array.from(subMenuRef.current.querySelectorAll<HTMLButtonElement>('button[data-menuitem="true"]'));
  }, []);

  const activeModel = currentModelValue(persona);

  useClickOutside(menuRef, true, onClose);
  const pos = useViewportClampFixed(menuRef, x, y);

  const handleModelSwitch = useCallback(async (value: string) => {
    const profile = quickModelToProfile(value);
    try {
      await applyPersonaOp(persona.id, { kind: 'SwitchModel', model_profile: profile });
    } catch {
      addToast('Failed to switch model', 'error');
    }
    onClose();
  }, [persona.id, applyPersonaOp, onClose, addToast]);

  const handleToggleEnabled = useCallback(async () => {
    try {
      await applyPersonaOp(persona.id, { kind: 'ToggleEnabled', enabled: !persona.enabled });
    } catch {
      addToast('Failed to toggle agent', 'error');
    }
    onClose();
  }, [persona.id, persona.enabled, applyPersonaOp, onClose]);

  const handleDuplicate = useCallback(async () => {
    try {
      const newPersona = await duplicatePersona(persona.id);
      addToast(`Duplicated as "${newPersona.name}"`, 'success');
      selectPersona(newPersona.id);
    } catch {
      addToast('Failed to duplicate agent', 'error');
    }
    onClose();
  }, [persona.id, duplicatePersona, selectPersona, addToast, onClose]);

  const handleDeleteClick = useCallback(() => {
    setShowDeleteModal(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    try {
      await deletePersona(persona.id);
      setShowDeleteModal(false);
      onClose();
    } catch {
      addToast('Failed to delete agent', 'error');
      setShowDeleteModal(false);
      onClose();
    }
  }, [persona.id, deletePersona, onClose, addToast]);

  // Submenu positioning
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!showModelSub || !modelItemRef.current || !menuRef.current) {
      setSubPos(null);
      return;
    }
    const itemRect = modelItemRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    let left = menuRect.right + 2;
    let top = itemRect.top;
    if (left + 160 > window.innerWidth - 8) left = menuRect.left - 162;
    if (top + 220 > window.innerHeight - 8) top = window.innerHeight - 228;
    if (top < 4) top = 4;
    setSubPos({ left, top });
  }, [showModelSub]);

  useEffect(() => {
    const items = getMainItems();
    items[0]?.focus();
  }, [getMainItems]);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (showModelSub) { setShowModelSub(false); modelItemRef.current?.focus(); return; }
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      const mainItems = getMainItems();
      const subItems = showModelSub ? getSubItems() : [];
      const allItems = [...mainItems, ...subItems];
      if (allItems.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = allItems.findIndex((item) => item === active);
      const dir = e.shiftKey ? -1 : 1;
      const nextIdx = idx === -1 ? (e.shiftKey ? allItems.length - 1 : 0) : (idx + dir + allItems.length) % allItems.length;
      e.preventDefault();
      allItems[nextIdx]?.focus();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const inSubmenu = !!active?.closest('[data-menu-scope="sub"]');
    const items = inSubmenu ? getSubItems() : getMainItems();
    if (items.length === 0) return;
    const idx = items.findIndex((item) => item === active);
    const focusIndex = (next: number) => items[(next + items.length) % items.length]?.focus();
    if (e.key === 'ArrowDown') { e.preventDefault(); focusIndex(idx === -1 ? 0 : idx + 1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); focusIndex(idx === -1 ? items.length - 1 : idx - 1); return; }
    if (e.key === 'ArrowRight' && !inSubmenu && active === modelItemRef.current) {
      e.preventDefault();
      setShowModelSub(true);
      requestAnimationFrame(() => { getSubItems()[0]?.focus(); });
      return;
    }
    if (e.key === 'ArrowLeft' && inSubmenu) {
      e.preventDefault();
      setShowModelSub(false);
      modelItemRef.current?.focus();
    }
  }, [getMainItems, getSubItems, onClose, showModelSub]);

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.1 }}
      className="fixed z-100 w-44 py-1 glass-md rounded-lg shadow-xl origin-top-left"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      aria-label={`Actions for ${persona.name}`}
      data-menu-scope="main"
      onKeyDown={handleMenuKeyDown}
    >
      <div className="px-3 py-1.5 border-b border-primary/10">
        <span className="text-sm font-medium text-foreground/70 truncate block">{persona.name}</span>
      </div>

      <Button
        ref={modelItemRef}
        variant="ghost"
        size="sm"
        onMouseEnter={() => setShowModelSub(true)}
        onMouseLeave={() => setShowModelSub(false)}
        onClick={() => setShowModelSub((v) => !v)}
        className="w-full px-3 py-1.5 text-left justify-start gap-2 text-foreground/90 relative rounded-none"
        role="menuitem" aria-haspopup="menu" aria-expanded={showModelSub} data-menuitem="true"
      >
        <Cpu className="w-3.5 h-3.5 text-muted-foreground/80" />
        <span className="flex-1">Model</span>
        <ChevronRight className="w-3 h-3 text-muted-foreground/60" />
      </Button>

      <Button variant="ghost" size="sm" onClick={handleToggleEnabled} className="w-full px-3 py-1.5 text-left justify-start gap-2 text-foreground/90 rounded-none" role="menuitem" data-menuitem="true">
        {persona.enabled ? (<><PowerOff className="w-3.5 h-3.5 text-amber-400/80" /><span>Disable</span></>) : (<><Power className="w-3.5 h-3.5 text-emerald-400/80" /><span>Enable</span></>)}
      </Button>

      <Button variant="ghost" size="sm" onClick={handleDuplicate} className="w-full px-3 py-1.5 text-left justify-start gap-2 text-foreground/90 rounded-none" role="menuitem" data-menuitem="true">
        <Copy className="w-3.5 h-3.5 text-muted-foreground/80" /><span>Duplicate</span>
      </Button>

      <div className="my-1 border-t border-primary/10" />

      <Button variant="ghost" size="sm" onClick={handleDeleteClick} className="w-full px-3 py-1.5 text-left justify-start gap-2 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 rounded-none" role="menuitem" data-menuitem="true">
        <Trash2 className="w-3.5 h-3.5" /><span>Delete</span>
      </Button>

      <BaseModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        titleId="delete-persona-dialog"
        maxWidthClass="max-w-sm"
        panelClassName="bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center flex-shrink-0">
              <Trash2 className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 id="delete-persona-dialog" className="text-sm font-semibold text-foreground/90">Delete Agent</h3>
              <p className="text-sm text-muted-foreground/90 mt-1">
                Permanently delete <span className="font-medium">{persona.name}</span> and all associated data.
              </p>
            </div>
          </div>

          <BlastRadiusPanel items={blastItems} loading={blastLoading} />

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => setShowDeleteModal(false)}
              className="px-4 py-2 text-sm text-muted-foreground/80 hover:text-foreground/95 rounded-xl hover:bg-secondary/40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              className="px-4 py-2 text-sm font-medium rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </BaseModal>

      <AnimatePresence>
        {showModelSub && subPos && (
          <ModelSubmenu
            subMenuRef={subMenuRef}
            subPos={subPos}
            activeModel={activeModel}
            onModelSwitch={handleModelSwitch}
            onMouseEnter={() => setShowModelSub(true)}
            onMouseLeave={() => setShowModelSub(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
