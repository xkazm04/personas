import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Bot, Home, BarChart3, Radio, Key, FlaskConical, Users,
  Cloud, Settings, Plus, Power, Workflow, Play, ToggleLeft, Copy,
  HeartPulse, Pencil,
} from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from "@/stores/toastStore";
import type { SidebarSection } from '@/lib/types/types';
import {
  type PaletteItem, type ResultKind,
  fuzzyMatch, fuzzyScore, trackRecent, getRecentAgentIds,
  agentItem, credentialItem, templateItem, automationItem,
  agentActionItems, type AgentActionCallbacks,
} from './commandPaletteUtils';
import { executePersona } from '@/api/agents/executions';
import { duplicatePersona } from '@/api/agents/personas';
import { systemHealthCheck } from '@/api/system/system';
import { CommandPaletteResults } from './CommandPaletteResults';
import { QuickEditPanel } from './QuickEditPanel';
import type { Persona } from '@/lib/bindings/Persona';

// -- Section icons -----------------------------------------------------

const NAV_ITEMS: { id: SidebarSection; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <Home className="w-4 h-4" /> },
  { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'personas', label: 'Agents', icon: <Bot className="w-4 h-4" /> },
  { id: 'events', label: 'Event Bus', icon: <Radio className="w-4 h-4" /> },
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
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const personas = useAgentStore((s) => s.personas);
  const groups = usePipelineStore((s) => s.groups);
  const recipes = usePipelineStore((s) => s.recipes);
  const credentials = useVaultStore((s) => s.credentials);
  const automations = useVaultStore((s) => s.automations);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const setIsCreatingPersona = useSystemStore((s) => s.setIsCreatingPersona);
  const storeUpdatePersona = useAgentStore((s) => s.updatePersona);
  const storeFetchPersonas = useAgentStore((s) => s.fetchPersonas);
  const addToast = useToastStore((s) => s.addToast);

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
      setEditingPersona(null);
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
  const keyIcon = <Key className="w-4 h-4" />;
  const flaskIcon = <FlaskConical className="w-4 h-4" />;
  const workflowIcon = <Workflow className="w-4 h-4" />;
  const playIcon = <Play className="w-4 h-4" />;
  const toggleIcon = <ToggleLeft className="w-4 h-4" />;
  const copyIcon = <Copy className="w-4 h-4" />;
  const healthIcon = <HeartPulse className="w-4 h-4" />;
  const pencilIcon = <Pencil className="w-4 h-4" />;

  const agentActions = useCallback((): AgentActionCallbacks => ({
    onRun: (id: string) => {
      executePersona(id).then(
        () => addToast('Execution started', 'success'),
        () => addToast('Failed to start execution', 'error'),
      );
    },
    onToggle: (id: string, enabled: boolean) => {
      storeUpdatePersona(id, { enabled }).then(
        () => addToast(`Agent ${enabled ? 'enabled' : 'disabled'}`, 'success'),
        () => addToast('Failed to toggle agent', 'error'),
      );
    },
    onDuplicate: (id: string) => {
      duplicatePersona(id).then(
        (p) => {
          storeFetchPersonas();
          addToast(`Duplicated as "${p.name}"`, 'success');
        },
        () => addToast('Failed to duplicate agent', 'error'),
      );
    },
    onHealthCheck: () => {
      systemHealthCheck().then(
        () => {
          setSidebarSection('overview');
          addToast('Health check complete', 'success');
        },
        () => addToast('Health check failed', 'error'),
      );
    },
    onNavigate: (id: string) => {
      setSidebarSection('personas');
      selectPersona(id);
    },
    onQuickEdit: (id: string) => {
      const p = personas.find(a => a.id === id);
      if (p) setEditingPersona(p);
    },
  }), [addToast, storeUpdatePersona, storeFetchPersonas, setSidebarSection, selectPersona, personas]);

  const items = useMemo((): PaletteItem[] => {
    const results: PaletteItem[] = [];
    const recentAgentIds = getRecentAgentIds();

    if (isCommandMode) {
      const cbs = agentActions();
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
        ...agentActionItems(personas, cbs, {
          run: playIcon, toggle: toggleIcon, duplicate: copyIcon,
          health: healthIcon, edit: pencilIcon,
        }),
      ];
      if (!searchQuery) return actions;
      return actions
        .filter(a => fuzzyMatch(searchQuery, a.label))
        .sort((a, b) => fuzzyScore(searchQuery, b.label) - fuzzyScore(searchQuery, a.label));
    }

    // -- Agents --
    if (!searchQuery && recentAgentIds.length > 0) {
      const personaMap = new Map(personas.map(p => [p.id, p]));
      for (const id of recentAgentIds) {
        const p = personaMap.get(id);
        if (!p) continue;
        results.push(agentItem(p, groupMap, selectPersona, setSidebarSection, botIcon, powerIcon));
      }
    }

    if (searchQuery) {
      const scoredAgents = personas
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

      for (const { persona } of scoredAgents) {
        if (!results.some(r => r.id === `agent:${persona.id}`)) {
          results.push(agentItem(persona, groupMap, selectPersona, setSidebarSection, botIcon, powerIcon));
        }
      }

      // -- Credentials --
      const scoredCreds = credentials
        .map(c => ({ cred: c, score: Math.max(fuzzyScore(searchQuery, c.name), fuzzyScore(searchQuery, c.service_type) * 0.7) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      for (const { cred } of scoredCreds) {
        results.push(credentialItem(cred, setSidebarSection, keyIcon));
      }

      // -- Templates --
      const scoredTemplates = recipes
        .map(r => ({ recipe: r, score: Math.max(fuzzyScore(searchQuery, r.name), fuzzyScore(searchQuery, r.category ?? '') * 0.6) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      for (const { recipe } of scoredTemplates) {
        results.push(templateItem(recipe, setSidebarSection, flaskIcon));
      }

      // -- Automations --
      const scoredAutomations = automations
        .map(a => ({ auto: a, score: Math.max(fuzzyScore(searchQuery, a.name), fuzzyScore(searchQuery, a.platform) * 0.5) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      for (const { auto: a } of scoredAutomations) {
        results.push(automationItem(a, setSidebarSection, workflowIcon));
      }

    }

    // -- Navigation --
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
  }, [personas, groups, groupMap, credentials, recipes, automations, searchQuery, isCommandMode, selectPersona, setSidebarSection, setIsCreatingPersona, botIcon, powerIcon, keyIcon, flaskIcon, workflowIcon, agentActions, playIcon, toggleIcon, copyIcon, healthIcon, pencilIcon]);

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleQuickEditSave = useCallback((id: string, updates: { description?: string; model?: string }) => {
    const partial: Record<string, unknown> = {};
    if (updates.description !== undefined) partial.description = updates.description || null;
    if (updates.model !== undefined) {
      const existing = editingPersona?.model_profile;
      let profile: Record<string, unknown> = {};
      if (existing) { try { profile = JSON.parse(existing); } catch { /* keep empty */ } }
      profile.model = updates.model || null;
      partial.model_profile = JSON.stringify(profile);
    }
    storeUpdatePersona(id, partial as Parameters<typeof storeUpdatePersona>[1]).then(
      () => { addToast('Agent updated', 'success'); close(); },
      () => addToast('Failed to update agent', 'error'),
    );
  }, [storeUpdatePersona, addToast, close, editingPersona]);

  const executeItem = useCallback((item: PaletteItem) => {
    if (item.kind === 'agent') trackRecent(item.id.replace('agent:', ''));
    item.onSelect();
    if (!item.staysOpen) close();
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
      addSection('agent-action', 'Agent Actions');
    } else {
      addSection('agent', !searchQuery && recentAgentIds.length > 0 ? 'Recent Agents' : 'Agents');
      addSection('credential', 'Credentials');
      addSection('template', 'Templates');
      addSection('automation', 'Automations');
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
            className="absolute inset-0 bg-black/50 backdrop-blur-md"
            onClick={() => { if (editingPersona) setEditingPersona(null); else close(); }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-lg glass-md rounded-xl shadow-elevation-4 overflow-hidden"
          >
            {!editingPersona && (
              <div className="flex items-center gap-3 px-4 py-3 border-b border-primary/10">
                <Search className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                  onKeyDown={handleKeyDown}
                  placeholder='Search agents, credentials, templates... (type ">" for commands)'
                  className="flex-1 bg-transparent typo-body text-foreground placeholder:text-muted-foreground/40 outline-none"
                  spellCheck={false}
                />
                <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/50 bg-secondary/50 border border-primary/10 rounded">
                  ESC
                </kbd>
              </div>
            )}

            {editingPersona ? (
              <QuickEditPanel
                persona={editingPersona}
                onSave={handleQuickEditSave}
                onCancel={() => setEditingPersona(null)}
              />
            ) : (
              <>
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
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
