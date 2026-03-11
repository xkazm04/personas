import { useState, useRef, useCallback, useEffect } from 'react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useViewportClampFixed } from '@/hooks/utility/interaction/useViewportClamp';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Copy, Power, PowerOff, Trash2, ChevronRight, AlertTriangle } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import { Button } from '@/features/shared/components/buttons';
import type { DbPersona } from '@/lib/types/types';
import { quickModelToProfile, currentModelValue } from './quickModelUtils';
import { ModelSubmenu } from './ModelSubmenu';

// ── Context Menu Component ────────────────────────────────────────────

export interface ContextMenuState {
  persona: DbPersona;
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
  const applyPersonaOp = usePersonaStore((s) => s.applyPersonaOp);
  const duplicatePersona = usePersonaStore((s) => s.duplicatePersona);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const deletePersona = usePersonaStore((s) => s.deletePersona);
  const addToast = useToastStore((s) => s.addToast);

  const [showModelSub, setShowModelSub] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const modelItemRef = useRef<HTMLButtonElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);

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

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deletePersona(persona.id);
    onClose();
  }, [confirmDelete, persona.id, deletePersona, onClose]);

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
  }, [getMainItems, confirmDelete]);

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
      className="fixed z-100 w-44 py-1 bg-background/95 backdrop-blur-md border border-primary/20 rounded-lg shadow-xl origin-top-left"
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

      {!confirmDelete ? (
        <Button variant="ghost" size="sm" onClick={handleDelete} className="w-full px-3 py-1.5 text-left justify-start gap-2 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 rounded-none" role="menuitem" data-menuitem="true">
          <Trash2 className="w-3.5 h-3.5" /><span>Delete</span>
        </Button>
      ) : (
        <div className="px-2 py-1.5 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
          <span className="text-sm text-amber-400/80 shrink-0">Sure?</span>
          <Button variant="danger" size="xs" onClick={handleDelete} className="flex-1" role="menuitem" data-menuitem="true">Delete</Button>
          <Button variant="secondary" size="xs" onClick={() => setConfirmDelete(false)} role="menuitem" data-menuitem="true">No</Button>
        </div>
      )}

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
