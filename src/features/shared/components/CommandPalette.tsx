import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Bot, Home, BarChart3, Zap, Key, FlaskConical, Users,
  Cloud, Settings, Plus, Power, ArrowRight,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { SidebarSection } from '@/lib/types/types';
import type { Persona } from '@/lib/bindings/Persona';

// ── Types ─────────────────────────────────────────────────────────────

type ResultKind = 'agent' | 'navigation' | 'action';

interface PaletteItem {
  id: string;
  kind: ResultKind;
  label: string;
  description?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

// ── Fuzzy match ───────────────────────────────────────────────────────

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 80;
  // Subsequence score
  let qi = 0;
  let gaps = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
    else if (qi > 0) gaps++;
  }
  return qi === q.length ? Math.max(10, 70 - gaps) : 0;
}

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

// ── Recent agents (session-scoped) ────────────────────────────────────

const MAX_RECENT = 5;
let recentAgentIds: string[] = [];

function trackRecent(id: string) {
  recentAgentIds = [id, ...recentAgentIds.filter(r => r !== id)].slice(0, MAX_RECENT);
}

// ── Component ─────────────────────────────────────────────────────────

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

  // Global Ctrl+K / Cmd+K listener
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

  // Reset on open
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

  // Build persona lookup by group
  const groupMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of groups) map[g.id] = g.name;
    return map;
  }, [groups]);

  // Build result items
  const items = useMemo((): PaletteItem[] => {
    const results: PaletteItem[] = [];

    if (isCommandMode) {
      // Command mode: actions only
      const actions: PaletteItem[] = [
        {
          id: 'cmd:create-agent',
          kind: 'action',
          label: 'Create New Agent',
          icon: <Plus className="w-4 h-4" />,
          onSelect: () => { setSidebarSection('personas'); setIsCreatingPersona(true); },
        },
        ...NAV_ITEMS.map(nav => ({
          id: `cmd:nav-${nav.id}`,
          kind: 'action' as const,
          label: `Go to ${nav.label}`,
          icon: nav.icon,
          onSelect: () => setSidebarSection(nav.id),
        })),
      ];

      if (!searchQuery) return actions;
      return actions
        .filter(a => fuzzyMatch(searchQuery, a.label))
        .sort((a, b) => fuzzyScore(searchQuery, b.label) - fuzzyScore(searchQuery, a.label));
    }

    // Default mode: recent agents, then agents, then navigation

    // Recent agents section (no query)
    if (!searchQuery && recentAgentIds.length > 0) {
      const personaMap = new Map(personas.map(p => [p.id, p]));
      for (const id of recentAgentIds) {
        const p = personaMap.get(id);
        if (!p) continue;
        results.push(agentItem(p, groupMap, selectPersona, setSidebarSection));
      }
    }

    // Agents
    if (searchQuery) {
      const scored = personas
        .map(p => ({
          persona: p,
          score: Math.max(
            fuzzyScore(searchQuery, p.name),
            fuzzyScore(searchQuery, p.description ?? ''),
            p.group_id && groupMap[p.group_id]
              ? fuzzyScore(searchQuery, groupMap[p.group_id]!) * 0.6
              : 0,
          ),
        }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      for (const { persona } of scored) {
        if (!results.some(r => r.id === `agent:${persona.id}`)) {
          results.push(agentItem(persona, groupMap, selectPersona, setSidebarSection));
        }
      }
    }

    // Navigation items
    const navItems = NAV_ITEMS.map(nav => ({
      id: `nav:${nav.id}`,
      kind: 'navigation' as const,
      label: nav.label,
      icon: nav.icon,
      onSelect: () => setSidebarSection(nav.id),
    }));

    if (searchQuery) {
      const filtered = navItems
        .filter(n => fuzzyMatch(searchQuery, n.label))
        .sort((a, b) => fuzzyScore(searchQuery, b.label) - fuzzyScore(searchQuery, a.label));
      results.push(...filtered);
    } else {
      results.push(...navItems);
    }

    return results;
  }, [personas, groups, groupMap, searchQuery, isCommandMode, selectPersona, setSidebarSection, setIsCreatingPersona]);

  // Clamp selection
  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Scroll selected into view
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

  // Group items by kind for section headers
  const sections = useMemo(() => {
    const grouped: { kind: ResultKind; label: string; items: (PaletteItem & { globalIndex: number })[] }[] = [];
    let idx = 0;

    const addSection = (kind: ResultKind, label: string) => {
      const sectionItems = items
        .filter(i => i.kind === kind)
        .map(i => ({ ...i, globalIndex: idx++ }));
      if (sectionItems.length > 0) grouped.push({ kind, label, items: sectionItems });
    };

    // In command mode everything is action
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
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={close}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-lg bg-background border border-primary/15 rounded-xl shadow-2xl overflow-hidden"
          >
            {/* Search input */}
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

            {/* Results */}
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
              {sections.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground/50">
                  No results found
                </div>
              )}

              {sections.map(section => (
                <div key={section.kind}>
                  <div className="px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/40">
                    {section.label}
                  </div>
                  {section.items.map(item => (
                    <button
                      key={item.id}
                      data-index={item.globalIndex}
                      onClick={() => executeItem(item)}
                      onMouseEnter={() => setSelectedIndex(item.globalIndex)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                        selectedIndex === item.globalIndex
                          ? 'bg-primary/10 text-foreground'
                          : 'text-foreground/80 hover:bg-secondary/40'
                      }`}
                    >
                      <span className={`shrink-0 ${selectedIndex === item.globalIndex ? 'text-primary' : 'text-muted-foreground/60'}`}>
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate text-sm">{item.label}</span>
                      {item.description && (
                        <span className="text-xs text-muted-foreground/40 truncate max-w-[140px]">
                          {item.description}
                        </span>
                      )}
                      {selectedIndex === item.globalIndex && (
                        <ArrowRight className="w-3 h-3 text-primary/50 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* Footer hint */}
            <div className="flex items-center gap-4 px-4 py-2 border-t border-primary/10 text-[11px] text-muted-foreground/40">
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

// ── Helpers ───────────────────────────────────────────────────────────

function agentItem(
  p: Persona,
  groupMap: Record<string, string>,
  selectPersona: (id: string) => void,
  setSidebarSection: (s: SidebarSection) => void,
): PaletteItem {
  return {
    id: `agent:${p.id}`,
    kind: 'agent',
    label: p.name,
    description: p.group_id ? groupMap[p.group_id] : undefined,
    icon: p.enabled
      ? <Bot className="w-4 h-4" />
      : <Power className="w-4 h-4 text-muted-foreground/40" />,
    onSelect: () => { setSidebarSection('personas'); selectPersona(p.id); },
  };
}
