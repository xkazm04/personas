import { useState, useMemo, type DragEvent } from 'react';
import { Bot, ChevronDown, ChevronRight, Search, Store } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import { DRAG_TYPE_PERSONA, DRAG_TYPE_EVENT_SOURCE } from '../hooks/useEventCanvasDragDrop';

type SidebarView = 'personas' | 'marketplace';

interface Props {
  personas: Persona[];
  triggers: PersonaTrigger[];
  onCanvasPersonaIds: Set<string>;
  onCanvasEventTypes: Set<string>;
  /** Render marketplace content */
  marketplaceContent: React.ReactNode;
}

interface ParsedEventInfo {
  eventType: string;
  sourceFilter?: string;
}

function parseEventListenerTriggers(triggers: PersonaTrigger[], personaId: string): ParsedEventInfo[] {
  const events: ParsedEventInfo[] = [];
  const seen = new Set<string>();
  for (const t of triggers) {
    if (t.persona_id !== personaId || t.trigger_type !== 'event_listener' || !t.config) continue;
    try {
      const cfg = JSON.parse(t.config);
      const et = cfg.listen_event_type;
      if (et && !seen.has(et)) {
        seen.add(et);
        events.push({ eventType: et, sourceFilter: cfg.source_filter });
      }
    } catch { /* skip */ }
  }
  return events;
}

export function PersonaPalette({ personas, triggers, onCanvasPersonaIds, onCanvasEventTypes, marketplaceContent }: Props) {
  const [view, setView] = useState<SidebarView>('personas');
  const [search, setSearch] = useState('');
  const [expandedPersonas, setExpandedPersonas] = useState<Set<string>>(new Set());

  const sorted = useMemo(() =>
    [...personas].sort((a, b) => a.name.localeCompare(b.name)),
    [personas],
  );

  const lc = search.toLowerCase();
  const filtered = sorted.filter(p => !lc || p.name.toLowerCase().includes(lc));

  const toggleExpanded = (id: string) => {
    setExpandedPersonas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* View toggle header */}
      <div className="flex items-center border-b border-primary/5 px-1 pt-2 pb-1 gap-0.5 flex-shrink-0">
        <button
          onClick={() => setView('personas')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
            view === 'personas'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
          }`}
        >
          <Bot className="w-3 h-3" />
          Personas
        </button>
        <button
          onClick={() => setView('marketplace')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
            view === 'marketplace'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
          }`}
        >
          <Store className="w-3 h-3" />
          Marketplace
        </button>
      </div>

      {view === 'marketplace' ? (
        <div className="flex-1 overflow-y-auto">{marketplaceContent}</div>
      ) : (
        <>
          {/* Search */}
          <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter personas..."
                className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-secondary/50 border border-primary/10 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Persona list */}
          <div className="flex-1 overflow-y-auto px-1.5 pb-2">
            {filtered.map(p => {
              const isExpanded = expandedPersonas.has(p.id);
              const personaEvents = parseEventListenerTriggers(triggers, p.id);
              const hasEvents = personaEvents.length > 0;

              return (
                <div key={p.id} className="mb-0.5">
                  {/* Persona row */}
                  <div className="flex items-center gap-0.5">
                    {/* Expand toggle */}
                    <button
                      onClick={() => hasEvents && toggleExpanded(p.id)}
                      className={`p-0.5 rounded ${hasEvents ? 'hover:bg-secondary/50 text-muted-foreground/50 hover:text-muted-foreground' : 'text-transparent cursor-default'}`}
                      disabled={!hasEvents}
                    >
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>

                    {/* Draggable persona */}
                    <DraggablePersona
                      persona={p}
                      isOnCanvas={onCanvasPersonaIds.has(p.id)}
                      eventCount={personaEvents.length}
                    />
                  </div>

                  {/* Expanded events list */}
                  {isExpanded && hasEvents && (
                    <div className="ml-5 pl-2 border-l border-primary/8 mt-0.5 mb-1">
                      {personaEvents.map(ev => (
                        <DraggableEvent
                          key={ev.eventType}
                          eventType={ev.eventType}
                          sourceFilter={ev.sourceFilter}
                          isOnCanvas={onCanvasEventTypes.has(ev.eventType)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {filtered.length === 0 && (
              <p className="px-2 py-4 text-[10px] text-muted-foreground/50 italic text-center">
                {personas.length === 0 ? 'No personas created yet' : 'No matches'}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable persona item
// ---------------------------------------------------------------------------

function DraggablePersona({ persona: p, isOnCanvas, eventCount }: { persona: Persona; isOnCanvas: boolean; eventCount: number }) {
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE_PERSONA, p.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`
        flex-1 flex items-center gap-2 px-1.5 py-1.5 rounded-lg cursor-grab active:cursor-grabbing
        hover:bg-secondary/60 transition-colors
        ${isOnCanvas ? 'opacity-50' : ''}
        ${!p.enabled ? 'opacity-40' : ''}
      `}
      title={p.description ?? p.name}
    >
      <div className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-primary/5">
        {p.icon ? (
          <span className="text-xs">{p.icon}</span>
        ) : (
          <Bot className="w-3 h-3 text-muted-foreground" />
        )}
      </div>

      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[11px] font-medium text-foreground truncate">{p.name}</span>
        {!p.enabled && <span className="text-[9px] text-muted-foreground/50">disabled</span>}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {eventCount > 0 && (
          <span className="text-[9px] text-muted-foreground/40">{eventCount}e</span>
        )}
        {isOnCanvas && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="On canvas" />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable event item (from persona's expanded list)
// ---------------------------------------------------------------------------

function DraggableEvent({ eventType, sourceFilter, isOnCanvas }: { eventType: string; sourceFilter?: string; isOnCanvas: boolean }) {
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE_EVENT_SOURCE, eventType);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`
        flex items-center gap-1.5 px-1.5 py-1 rounded-md cursor-grab active:cursor-grabbing
        hover:bg-secondary/50 transition-colors text-[10px]
        ${isOnCanvas ? 'opacity-50' : ''}
      `}
      title={sourceFilter ? `${eventType} (${sourceFilter})` : eventType}
    >
      <span className="w-1 h-1 rounded-full bg-cyan-400 flex-shrink-0" />
      <span className="text-muted-foreground truncate">{eventType}</span>
      {isOnCanvas && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
    </div>
  );
}
