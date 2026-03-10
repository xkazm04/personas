import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Bot, Home, BarChart3, Zap, Key, FlaskConical, Users,
  Cloud, Settings, Plus, Power,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { SidebarSection } from '@/lib/types/types';
import {
  type PaletteItem, type ResultKind,
  fuzzyMatch, fuzzyScore, trackRecent, getRecentAgentIds, agentItem,
} from './commandPaletteUtils';
import { CommandPaletteResults } from './CommandPaletteResults';

// ── Section icons ─────────────────────────────────────────────────────

const NAV_ITEMS: { id: SidebarSection; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <Home className="w-4 h-4" /> },
  { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'personas', label: 'Agents', icon: <Bot className="w-4 h-4" /> },
  { id: 'events', label: 'Events', icon: <Zap className="w-4 h-4" /> },
  { id: 'credentials', label: 'Keys', icon: <Key className="w-4 h-4" /> },
  { id: 'design-reviews', label: 'Templates', icon: <FlaskConical className="w-4 h-4" /> },
  { id: 'team', label: 'Teams', icon: <Users className="w-4 h-4" /> },
  { id: 'cloud', label: 'Cloud', icon: <Cloud className="w-4 h-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const personas = usePersonaStore(s => s.personas);
  const groups = usePersonaStore(s => s.groups);
  const setSidebarSection = usePersonaStore(s => s.setSidebarSection);
  const selectPersona = usePersonaStore(s => s.selectPersona);
  const setIsCreatingPersona = usePersonaStore(s => s.setIsCreatingPersona);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const isCommandMode = query.startsWith('>');
  const searchQuery = isCommandMode ? query.slice(1).trim() : query.trim();

  const groupMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of groups) map[g.id] = g.name;
    return map;
  }, [groups]);

  const botIcon = <Bot className="w-4 h-4" />;
  const powerIcon = <Power className="w-4 h-4 text-muted-foreground/40" />;

  const items = useMemo((): PaletteItem[] => {
    const results: PaletteItem[] = [];
    const recentAgentIds = getRecentAgentIds();

    if (isCommandMode) {
      const actions: PaletteItem[] = [
        {
          id: 'cmd:create-agent', kind: 'action', label: 'Create New Agent',
          icon: <Plus className="w-4 h-4" />,
          onSelect: () => { setSidebarSection('personas'); setIsCreatingPersona(true); },
        },
        ...NAV_ITEMS.map(nav => ({
          id: `cmd:nav-${nav.id}`, kind: 'action' as const, label: `Go to ${nav.label}`,
          icon: nav.icon, onSelect: () => setSidebarSection(nav.id),
        })),
      ];
      if (!searchQuery) return actions;
      return actions
        .filter(a => fuzzyMatch(searchQuery, a.label))
        .sort((a, b) => fuzzyScore(searchQuery, b.label) - fuzzyScore(searchQuery, a.label));
    }

    if (!searchQuery && recentAgentIds.length > 0) {
      const personaMap = new Map(personas.map(p => [p.id, p]));
      for (const id of recentAgentIds) {
        const p = personaMap.get(id);
        if (!p) continue;
        results.push(agentItem(p, groupMap, selectPersona, setSidebarSection, botIcon, powerIcon));
      }
    }

    if (searchQuery) {
      const scored = personas
        .map(p => ({
          persona: p,
          score: Math.max(
            fuzzyScore(searchQuery, p.name),
            fuzzyScore(searchQuery, p.description ?? ''),
            p.group_id && groupMap[p.group_id] ? fuzzyScore(searchQuery, groupMap[p.group_id]!) * 0.6 : 0,
          ),
        }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      for (const { persona } of scored) {
        if (!results.some(r => r.id === `agent:${persona.id}`)) {
          results.push(agentItem(persona, groupMap, selectPersona, setSidebarSection, botIcon, powerIcon));
        }
      }
    }

    const navItems = NAV_ITEMS.map(nav => ({
      id: `nav:${nav.id}`, kind: 'navigation' as const, label: nav.label,
      icon: nav.icon, onSelect: () => setSidebarSection(nav.id),
    }));

    if (searchQuery) {
      results.push(...navItems.filter(n => fuzzyMatch(searchQuery, n.label))
        .sort((a, b) => fuzzyScore(searchQuery, b.label) - fuzzyScore(searchQuery, a.label)));
    } else {
      results.push(...navItems);
    }

    return results;
  }, [personas, groups, groupMap, searchQuery, isCommandMode, selectPersona, setSidebarSection, setIsCreatingPersona, botIcon, powerIcon]);

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const executeItem = useCallback((item: PaletteItem) => {
    if (item.kind === 'agent') trackRecent(item.id.replace('agent:', ''));
    item.onSelect();
    close();
  }, [close]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % Math.max(1, items.length));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + items.length) % Math.max(1, items.length));
        break;
      case 'Enter':
        e.preventDefault();
        if (items[selectedIndex]) executeItem(items[selectedIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  };

  const sections = useMemo(() => {
    const grouped: { kind: ResultKind; label: string; items: (PaletteItem & { globalIndex: number })[] }[] = [];
    let idx = 0;
    const recentAgentIds = getRecentAgentIds();
    const addSection = (kind: ResultKind, label: string) => {
      const sectionItems = items
        .filter(i => i.kind === kind)
        .map(i => ({ ...i, globalIndex: idx++ }));
      if (sectionItems.length > 0) grouped.push({ kind, label, items: sectionItems });
    };
    if (isCommandMode) {
      addSection('action', 'Commands');
    } else {
      addSection('agent', !searchQuery && recentAgentIds.length > 0 ? 'Recent Agents' : 'Agents');
      addSection('navigation', 'Navigation');
    }
    return grouped;
  }, [items, isCommandMode, searchQuery]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={close}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-lg bg-background border border-primary/15 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-primary/10">
              <Search className="w-4 h-4 text-muted-foreground/60 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                onKeyDown={handleKeyDown}
                placeholder='Search agents, navigate... (type ">" for commands)'
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
                spellCheck={false}
              />
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/50 bg-secondary/50 border border-primary/10 rounded">
                ESC
              </kbd>
            </div>

            <CommandPaletteResults
              sections={sections}
              selectedIndex={selectedIndex}
              onExecute={executeItem}
              onHover={setSelectedIndex}
              listRef={listRef}
            />

            <div className="flex items-center gap-4 px-4 py-2 border-t border-primary/10 text-[11px] text-muted-foreground/60">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-secondary/50 border border-primary/10 rounded text-[10px]">&uarr;&darr;</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-secondary/50 border border-primary/10 rounded text-[10px]">&crarr;</kbd>
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-secondary/50 border border-primary/10 rounded text-[10px]">&gt;</kbd>
                commands
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
