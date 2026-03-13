import { useState, useRef, useCallback, useEffect } from 'react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useViewportClampFixed } from '@/hooks/utility/interaction/useViewportClamp';
import { motion } from 'framer-motion';
import type { Persona } from '@/lib/types/types';
import { useContextMenuActions } from './ContextMenuActions';
import { MenuItems, ModelSubmenu } from './ContextMenuSections';

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
  const modelItemRef = useRef<HTMLButtonElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);

  const [showModelSub, setShowModelSub] = useState(false);

  const {
    confirmDelete, setConfirmDelete,
    handleModelSwitch, handleToggleEnabled, handleDuplicate, handleDelete, handleExportPersona,
  } = useContextMenuActions(persona.id, persona.enabled, onClose);

  const getMainItems = useCallback(() => {
    if (!menuRef.current) return [] as HTMLButtonElement[];
    return Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('button[data-menuitem="true"]'));
  }, []);

  const getSubItems = useCallback(() => {
    if (!subMenuRef.current) return [] as HTMLButtonElement[];
    return Array.from(subMenuRef.current.querySelectorAll<HTMLButtonElement>('button[data-menuitem="true"]'));
  }, []);

  useClickOutside(menuRef, true, onClose);
  const pos = useViewportClampFixed(menuRef, x, y);

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
      e.preventDefault(); setShowModelSub(true);
      requestAnimationFrame(() => { getSubItems()[0]?.focus(); });
      return;
    }
    if (e.key === 'ArrowLeft' && inSubmenu) { e.preventDefault(); setShowModelSub(false); modelItemRef.current?.focus(); }
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
      <MenuItems
        persona={persona}
        modelItemRef={modelItemRef}
        showModelSub={showModelSub}
        setShowModelSub={setShowModelSub}
        confirmDelete={confirmDelete}
        onToggleEnabled={handleToggleEnabled}
        onDuplicate={handleDuplicate}
        onExportPersona={handleExportPersona}
        onDelete={handleDelete}
        onCancelDelete={() => setConfirmDelete(false)}
      />
      <ModelSubmenu
        persona={persona}
        subMenuRef={subMenuRef}
        subPos={subPos}
        showModelSub={showModelSub}
        setShowModelSub={setShowModelSub}
        onModelSwitch={handleModelSwitch}
      />
    </motion.div>
  );
}
