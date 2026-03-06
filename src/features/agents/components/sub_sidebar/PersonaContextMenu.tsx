import { useState, useRef, useCallback, useEffect } from 'react';
import { useClickOutside } from '@/hooks/utility/useClickOutside';
import { useViewportClampFixed } from '@/hooks/utility/useViewportClamp';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Copy, Power, PowerOff, Trash2, ChevronRight, Check, AlertTriangle } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import type { DbPersona } from '@/lib/types/types';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import { profileToDropdownValue, OLLAMA_CLOUD_PRESETS, OLLAMA_CLOUD_BASE_URL } from '@/features/agents/sub_model_config/OllamaCloudPresets';

// ── Quick-switch model definitions ────────────────────────────────────

interface QuickModel {
  value: string;
  label: string;
  provider: string;
}

const QUICK_MODELS: QuickModel[] = [
  { value: '', label: 'Opus', provider: 'Anthropic' },
  { value: 'sonnet', label: 'Sonnet', provider: 'Anthropic' },
  { value: 'haiku', label: 'Haiku', provider: 'Anthropic' },
  ...OLLAMA_CLOUD_PRESETS.map((p) => ({
    value: p.value,
    label: p.label.split(' (')[0] ?? p.label,
    provider: 'Ollama',
  })),
];

/** Build model_profile JSON string from a quick model value. */
function quickModelToProfile(value: string): string | null {
  // Ollama cloud preset
  if (value.startsWith('ollama:')) {
    const preset = OLLAMA_CLOUD_PRESETS.find((p) => p.value === value);
    if (preset) {
      return JSON.stringify({
        model: preset.modelId,
        provider: 'ollama',
        base_url: OLLAMA_CLOUD_BASE_URL,
      } satisfies ModelProfile);
    }
  }
  // Opus = default (empty string value -> null profile)
  if (value === '') return null;
  // Standard Anthropic model
  return JSON.stringify({
    model: value,
    provider: 'anthropic',
  } satisfies ModelProfile);
}

/** Read the current dropdown value from a persona's model_profile JSON. */
function currentModelValue(persona: DbPersona): string {
  if (!persona.model_profile) return ''; // Opus default
  try {
    const mp: ModelProfile = JSON.parse(persona.model_profile);
    return profileToDropdownValue(mp);
  } catch {
    return '';
  }
}

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

  // Close on outside click or Escape (submenu is a DOM child of menuRef, so contains() covers it)
  useClickOutside(menuRef, true, onClose);

  // Clamp menu position to viewport
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
    // Flip left if overflows right
    if (left + 160 > window.innerWidth - 8) {
      left = menuRect.left - 162;
    }
    // Clamp top
    if (top + 220 > window.innerHeight - 8) {
      top = window.innerHeight - 228;
    }
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
      if (showModelSub) {
        setShowModelSub(false);
        modelItemRef.current?.focus();
        return;
      }
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
      const nextIdx = idx === -1
        ? (e.shiftKey ? allItems.length - 1 : 0)
        : (idx + dir + allItems.length) % allItems.length;
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

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusIndex(idx === -1 ? 0 : idx + 1);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusIndex(idx === -1 ? items.length - 1 : idx - 1);
      return;
    }

    if (e.key === 'ArrowRight' && !inSubmenu && active === modelItemRef.current) {
      e.preventDefault();
      setShowModelSub(true);
      requestAnimationFrame(() => {
        getSubItems()[0]?.focus();
      });
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
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-primary/10">
        <span className="text-sm font-medium text-foreground/70 truncate block">{persona.name}</span>
      </div>

      {/* Model Switch */}
      <button
        ref={modelItemRef}
        onMouseEnter={() => setShowModelSub(true)}
        onMouseLeave={() => setShowModelSub(false)}
        onClick={() => setShowModelSub((v) => !v)}
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
        onClick={handleToggleEnabled}
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
        onClick={handleDuplicate}
        className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/60 flex items-center gap-2 text-foreground/90"
        role="menuitem"
        data-menuitem="true"
      >
        <Copy className="w-3.5 h-3.5 text-muted-foreground/80" />
        <span>Duplicate</span>
      </button>

      {/* Separator */}
      <div className="my-1 border-t border-primary/10" />

      {/* Delete */}
      {!confirmDelete ? (
        <button
          onClick={handleDelete}
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
            onClick={handleDelete}
            className="flex-1 px-2 py-0.5 bg-red-500 hover:bg-red-600 text-foreground rounded text-sm font-medium transition-colors"
            role="menuitem"
            data-menuitem="true"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="px-2 py-0.5 bg-secondary/50 text-foreground/80 rounded text-sm transition-colors hover:bg-secondary/70"
            role="menuitem"
            data-menuitem="true"
          >
            No
          </button>
        </div>
      )}

      {/* Model Submenu */}
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
                    onClick={() => handleModelSwitch(model.value)}
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
    </motion.div>
  );
}
