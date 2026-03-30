/**
 * Event Routing Table
 *
 * Flat table listing ALL event types (common catalog events + persona-specific).
 * Columns: Source (filterable) | Event | Connected Personas (chips) | Actions (⋯)
 *
 * - Each row's persona chips have a disconnect option (with confirmation dialog).
 * - Three-dot action menu per row to add a persona.
 * - Source column is filterable: "All", specific persona, or "Common".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, MoreHorizontal, Plus, X, Zap, Search, Filter,
  Radio, RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaGroup } from '@/lib/bindings/PersonaGroup';
import { createTrigger, deleteTrigger, listAllTriggers } from '@/api/pipeline/triggers';
import {
  EVENT_SOURCE_CATEGORIES,
  findTemplateByEventType,
  type EventSourceTemplate,
} from '../libs/eventCanvasConstants';
import { AddPersonaModal } from './AddPersonaModal';
import { DisconnectDialog } from './DisconnectDialog';

import {
  Clock, Globe, Webhook, Link, Clipboard, AppWindow,
  Layers, FileEdit, CheckCircle2, XCircle, Store,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow,
  Layers, Zap, FileEdit, CheckCircle2, XCircle, Store,
};

function resolveIcon(tmpl: EventSourceTemplate | undefined): LucideIcon {
  if (!tmpl) return Zap;
  const name = tmpl.icon?.displayName;
  return name ? (ICON_MAP[name] ?? Zap) : Zap;
}

// ── Row data ─────────────────────────────────────────────────────────────

interface EventRow {
  eventType: string;
  template: EventSourceTemplate | undefined;
  /** "common" for catalog events, persona name for persona-emitted events */
  sourceLabel: string;
  sourcePersonaId: string | null;
  connections: {
    triggerId: string;
    personaId: string;
    persona: Persona | undefined;
  }[];
}

// ── Props ────────────────────────────────────────────────────────────────

interface Props {
  initialTriggers: PersonaTrigger[];
  personas: Persona[];
  groups: PersonaGroup[];
}

// ── Component ────────────────────────────────────────────────────────────

export function UnifiedRoutingView({ initialTriggers, personas, groups }: Props) {
  const [allTriggers, setAllTriggers] = useState<PersonaTrigger[]>(initialTriggers);
  const [sourceFilter, setSourceFilter] = useState<string>('all'); // 'all' | 'common' | personaId
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [eventSearch, setEventSearch] = useState('');
  const [actionMenuRow, setActionMenuRow] = useState<string | null>(null);
  const [addPersonaForEvent, setAddPersonaForEvent] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<{ triggerId: string; personaId: string; personaName: string; eventLabel: string } | null>(null);

  const sourceDropdownRef = useRef<HTMLDivElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setAllTriggers(initialTriggers); }, [initialTriggers]);

  const reload = useCallback(async () => {
    try { setAllTriggers(await listAllTriggers()); } catch { /* best-effort */ }
  }, []);

  const personaMap = useMemo(() => {
    const m = new Map<string, Persona>();
    for (const p of personas) m.set(p.id, p);
    return m;
  }, [personas]);

  // ── Build rows ──

  const rows: EventRow[] = useMemo(() => {
    // 1. Rows from existing triggers (grouped by event_type)
    const triggerRows = new Map<string, EventRow>();
    for (const t of allTriggers) {
      if (t.trigger_type !== 'event_listener' || !t.config) continue;
      try {
        const cfg = JSON.parse(t.config) as Record<string, string | undefined>;
        const et = cfg.listen_event_type;
        if (!et) continue;
        let row = triggerRows.get(et);
        if (!row) {
          const tmpl = findTemplateByEventType(et);
          // Determine source: if it's in the catalog → "common", otherwise it's persona-specific
          const isCommon = !!tmpl;
          row = {
            eventType: et,
            template: tmpl,
            sourceLabel: isCommon ? 'Common' : et,
            sourcePersonaId: null,
            connections: [],
          };
          triggerRows.set(et, row);
        }
        row.connections.push({
          triggerId: t.id,
          personaId: t.persona_id,
          persona: personaMap.get(t.persona_id),
        });
      } catch { /* skip */ }
    }

    // 2. Add catalog events that have no connections yet
    for (const cat of EVENT_SOURCE_CATEGORIES) {
      for (const tmpl of cat.templates) {
        if (triggerRows.has(tmpl.eventType)) continue;
        triggerRows.set(tmpl.eventType, {
          eventType: tmpl.eventType,
          template: tmpl,
          sourceLabel: 'Common',
          sourcePersonaId: null,
          connections: [],
        });
      }
    }

    return Array.from(triggerRows.values()).sort((a, b) => {
      // Connected first, then by label
      const aHas = a.connections.length > 0 ? 0 : 1;
      const bHas = b.connections.length > 0 ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      return (a.template?.label ?? a.eventType).localeCompare(b.template?.label ?? b.eventType);
    });
  }, [allTriggers, personaMap]);

  // ── Source filter options ──

  const sourceOptions = useMemo(() => {
    const opts: { id: string; label: string; icon?: string }[] = [
      { id: 'all', label: 'All Sources' },
      { id: 'common', label: 'Common Events' },
    ];
    // Add personas that are the source of persona-specific events
    const personaSources = new Set<string>();
    for (const row of rows) {
      if (row.sourceLabel !== 'Common' && row.sourcePersonaId) {
        personaSources.add(row.sourcePersonaId);
      }
    }
    for (const pid of personaSources) {
      const p = personaMap.get(pid);
      if (p) opts.push({ id: p.id, label: p.name, icon: p.icon ?? undefined });
    }
    return opts;
  }, [rows, personaMap]);

  // ── Filtered rows ──

  const filteredRows = useMemo(() => {
    const q = eventSearch.toLowerCase().trim();
    return rows.filter(row => {
      // Source filter
      if (sourceFilter === 'common' && row.sourceLabel !== 'Common') return false;
      if (sourceFilter !== 'all' && sourceFilter !== 'common' && row.sourcePersonaId !== sourceFilter) {
        // Also keep common events when filtering by persona (they're relevant to all)
        if (row.sourceLabel !== 'Common') return false;
      }
      // Text search
      if (q) {
        const label = (row.template?.label ?? row.eventType).toLowerCase();
        const type = row.eventType.toLowerCase();
        if (!label.includes(q) && !type.includes(q)) return false;
      }
      return true;
    });
  }, [rows, sourceFilter, eventSearch]);

  // ── Actions ──

  const handleAddPersona = useCallback(async (personaId: string) => {
    if (!addPersonaForEvent) return;
    setAddPersonaForEvent(null);
    try {
      await createTrigger({
        persona_id: personaId,
        trigger_type: 'event_listener',
        config: JSON.stringify({ listen_event_type: addPersonaForEvent }),
        enabled: true,
        use_case_id: null,
      });
      await reload();
    } catch { /* best-effort */ }
  }, [addPersonaForEvent, reload]);

  const handleDisconnect = useCallback(async () => {
    if (!disconnectTarget) return;
    try {
      await deleteTrigger(disconnectTarget.triggerId, disconnectTarget.personaId);
      await reload();
    } catch { /* best-effort */ }
    setDisconnectTarget(null);
  }, [disconnectTarget, reload]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showSourceDropdown && !actionMenuRow) return;
    function handleClick(e: MouseEvent) {
      if (showSourceDropdown && sourceDropdownRef.current && !sourceDropdownRef.current.contains(e.target as Node)) {
        setShowSourceDropdown(false);
      }
      if (actionMenuRow && actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuRow(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSourceDropdown, actionMenuRow]);

  // Personas already connected to a given event (for the modal exclusion list)
  const connectedPersonaIdsForEvent = useMemo(() => {
    if (!addPersonaForEvent) return new Set<string>();
    const row = rows.find(r => r.eventType === addPersonaForEvent);
    return new Set(row?.connections.map(c => c.personaId) ?? []);
  }, [addPersonaForEvent, rows]);

  const currentSourceLabel = sourceOptions.find(o => o.id === sourceFilter)?.label ?? 'All Sources';
  const totalConnections = rows.reduce((sum, r) => sum + r.connections.length, 0);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-primary/10 bg-card/30 max-w-[900px]">
        {/* Source filter */}
        <div className="relative" ref={sourceDropdownRef}>
          <button
            onClick={() => setShowSourceDropdown(!showSourceDropdown)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/10 hover:border-primary/20 bg-card transition-colors"
          >
            <Filter className="w-3.5 h-3.5 text-muted-foreground/50" />
            <span className="text-sm font-medium text-foreground/80">{currentSourceLabel}</span>
          </button>

          {showSourceDropdown && (
            <div className="absolute top-full left-0 mt-1 w-52 rounded-xl bg-card border border-primary/15 shadow-elevation-4 py-1 z-30">
              {sourceOptions.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => { setSourceFilter(opt.id); setShowSourceDropdown(false); }}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors ${sourceFilter === opt.id ? 'bg-cyan-500/10 text-cyan-400' : 'text-foreground/70 hover:bg-secondary/40'}`}
                >
                  {opt.icon && <span className="text-sm">{opt.icon}</span>}
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <input
            type="text"
            value={eventSearch}
            onChange={e => setEventSearch(e.target.value)}
            placeholder="Filter events..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-secondary/30 border border-primary/10 rounded-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-cyan-400/40"
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground/50 tabular-nums">
            {filteredRows.length} event{filteredRows.length !== 1 ? 's' : ''} · {totalConnections} connection{totalConnections !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => void reload()}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/40 hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Table header ── */}
      <div className="flex items-center px-4 py-2.5 border-b border-primary/10 bg-card/20 max-w-[900px]">
        <span className="w-14 text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">Source</span>
        <span className="w-[420px] min-w-[420px] text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider pl-3">Event</span>
        <span className="flex-1 text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">Connected Personas</span>
        <span className="w-10" />
      </div>

      {/* ── Table body ── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filteredRows.length === 0 && (
          <div className="flex items-center justify-center py-16 text-center">
            <div>
              <Radio className="w-8 h-8 text-muted-foreground/15 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground/50">
                {eventSearch ? 'No matching events' : 'No events match this filter'}
              </p>
            </div>
          </div>
        )}

        {filteredRows.map(row => {
          const Icon = resolveIcon(row.template);
          const hasConnections = row.connections.length > 0;
          const isActionOpen = actionMenuRow === row.eventType;

          return (
            <div
              key={row.eventType}
              className={`
                flex items-center px-4 py-3 border-b border-primary/5 transition-colors max-w-[900px]
                ${hasConnections ? 'hover:bg-secondary/15' : 'hover:bg-secondary/8 opacity-60 hover:opacity-80'}
              `}
            >
              {/* Source badge */}
              <div className="w-14 flex-shrink-0">
                <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${row.sourceLabel === 'Common' ? 'bg-cyan-500/10 text-cyan-400/70' : 'bg-violet-500/10 text-violet-400/70'}`}>
                  {row.sourceLabel === 'Common' ? 'SYS' : 'USR'}
                </span>
              </div>

              {/* Event info */}
              <div className="w-[420px] min-w-[420px] flex-shrink-0 flex items-center gap-2.5 pl-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${row.template ? 'bg-cyan-500/10' : 'bg-violet-500/10'}`}>
                  <Icon className={`w-4 h-4 ${row.template?.color ?? 'text-violet-400'}`} />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-medium text-foreground">{row.template?.label ?? row.eventType}</div>
                  <div className="text-xs text-muted-foreground/40">{row.eventType}</div>
                </div>
              </div>

              {/* Connected personas */}
              <div className="flex-1 flex flex-wrap items-center gap-1.5 min-h-[32px]">
                {row.connections.length === 0 && (
                  <span className="text-sm text-muted-foreground/30 italic">No personas connected</span>
                )}
                {row.connections.map(conn => (
                  <div
                    key={conn.triggerId}
                    className="flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-lg bg-card border border-emerald-400/20 hover:border-emerald-400/40 group/chip transition-colors"
                  >
                    <div className="w-5 h-5 rounded flex items-center justify-center bg-emerald-500/10">
                      {conn.persona?.icon ? (
                        <span className="text-xs">{conn.persona.icon}</span>
                      ) : (
                        <Bot className="w-3 h-3 text-muted-foreground/40" />
                      )}
                    </div>
                    <span className="text-sm text-foreground/70">
                      {conn.persona?.name ?? conn.personaId.slice(0, 8)}
                    </span>
                    <button
                      onClick={() => setDisconnectTarget({
                        triggerId: conn.triggerId,
                        personaId: conn.personaId,
                        personaName: conn.persona?.name ?? conn.personaId.slice(0, 8),
                        eventLabel: row.template?.label ?? row.eventType,
                      })}
                      className="p-0.5 rounded opacity-0 group-hover/chip:opacity-100 hover:bg-red-500/15 text-red-400/50 hover:text-red-400 transition-all"
                      title="Disconnect"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Three-dot action menu */}
              <div className="w-10 flex-shrink-0 flex items-center justify-center relative">
                <button
                  onClick={() => setActionMenuRow(isActionOpen ? null : row.eventType)}
                  className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/40 hover:text-foreground transition-colors"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>

                {isActionOpen && (
                  <div
                    ref={actionMenuRef}
                    className="absolute right-0 top-full mt-1 w-48 rounded-xl bg-card border border-primary/15 shadow-elevation-4 py-1 z-30"
                  >
                    <button
                      onClick={() => {
                        setActionMenuRow(null);
                        setAddPersonaForEvent(row.eventType);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground/80 hover:bg-secondary/40 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-emerald-400" />
                      Add persona
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Add Persona Modal ── */}
      <AddPersonaModal
        open={!!addPersonaForEvent}
        personas={personas}
        groups={groups}
        alreadyActiveIds={connectedPersonaIdsForEvent}
        eventLabel={addPersonaForEvent ? (findTemplateByEventType(addPersonaForEvent)?.label ?? addPersonaForEvent) : ''}
        onAdd={handleAddPersona}
        onClose={() => setAddPersonaForEvent(null)}
      />

      {/* ── Disconnect Confirmation ── */}
      <DisconnectDialog
        open={!!disconnectTarget}
        personaName={disconnectTarget?.personaName ?? ''}
        eventLabel={disconnectTarget?.eventLabel ?? ''}
        onConfirm={handleDisconnect}
        onCancel={() => setDisconnectTarget(null)}
      />
    </div>
  );
}
