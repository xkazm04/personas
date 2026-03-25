import { useState, useMemo, type DragEvent } from 'react';
import { Bot, ChevronDown, ChevronRight, Search, Store } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import { setDragPayload, clearDragPayload, CANVAS_DND_MIME } from '../hooks/useEventCanvasDragDrop';

type SidebarView = 'personas' | 'marketplace';

interface Props {
  personas: Persona[];
  triggers: PersonaTrigger[];
  onCanvasPersonaIds: Set<string>;
  onCanvasEventTypes: Set<string>;
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
      <div className="flex items-center border-b border-primary/5 px-1.5 pt-2 pb-1.5 gap-1 flex-shrink-0">
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
          <div className="px-2.5 pt-2.5 pb-1 flex-shrink-0">
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
                <div key={p.id} className="mt-0.5">
                  <DraggablePersona
                    persona={p}
                    isOnCanvas={onCanvasPersonaIds.has(p.id)}
                    eventCount={personaEvents.length}
                    isExpanded={isExpanded}
                    onToggleExpand={hasEvents ? () => toggleExpanded(p.id) : undefined}
                  />

                  {/* Expanded events list — smooth height transition */}
                  {hasEvents && (
                    <div
                      className="overflow-hidden transition-all duration-200 ease-in-out"
                      style={{
                        maxHeight: isExpanded ? personaEvents.length * 28 + 8 : 0,
                        opacity: isExpanded ? 1 : 0,
                      }}
                    >
                      <div className="ml-7 pl-2.5 border-l border-primary/8 pt-0.5 pb-1">
                        {personaEvents.map(ev => (
                          <DraggableEvent
                            key={ev.eventType}
                            eventType={ev.eventType}
                            sourceFilter={ev.sourceFilter}
                            isOnCanvas={onCanvasEventTypes.has(ev.eventType)}
                          />
                        ))}
                      </div>
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
// Draggable persona — unified look regardless of event count
// ---------------------------------------------------------------------------

function DraggablePersona({
  persona: p,
  isOnCanvas,
  eventCount,
  isExpanded,
  onToggleExpand,
}: {
  persona: Persona;
  isOnCanvas: boolean;
  eventCount: number;
  isExpanded: boolean;
  onToggleExpand?: () => void;
}) {
  const onDragStart = (e: DragEvent) => {
    setDragPayload('persona', p.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(CANVAS_DND_MIME, p.id);
    e.dataTransfer.setData('text/plain', p.id);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={clearDragPayload}
      className={`
        flex items-center gap-2 px-2 py-[7px] rounded-lg cursor-grab active:cursor-grabbing
        hover:bg-secondary/60 transition-colors group
        ${isOnCanvas ? 'opacity-50' : ''}
        ${!p.enabled ? 'opacity-40' : ''}
      `}
      title={p.description ?? p.name}
    >
      {/* Icon */}
      <div className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-primary/5">
        {p.icon ? (
          <span className="text-xs">{p.icon}</span>
        ) : (
          <Bot className="w-3 h-3 text-muted-foreground" />
        )}
      </div>

      {/* Name */}
      <span className="text-[11px] font-medium text-foreground truncate flex-1 min-w-0">{p.name}</span>

      {/* Right side: on-canvas dot + event expand toggle (min-w keeps layout stable) */}
      <div className="flex items-center gap-1 flex-shrink-0 min-w-[28px] justify-end">
        {isOnCanvas && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="On canvas" />
        )}
        {eventCount > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] text-foreground/40 hover:text-foreground/70 hover:bg-secondary/50 transition-colors cursor-pointer"
            draggable={false}
            title={isExpanded ? 'Collapse events' : 'Show events'}
          >
            <span>{eventCount}</span>
            {isExpanded
              ? <ChevronDown className="w-2.5 h-2.5" />
              : <ChevronRight className="w-2.5 h-2.5" />
            }
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable event item (from persona's expanded list)
// ---------------------------------------------------------------------------

function DraggableEvent({ eventType, sourceFilter, isOnCanvas }: { eventType: string; sourceFilter?: string; isOnCanvas: boolean }) {
  const onDragStart = (e: DragEvent) => {
    setDragPayload('event', eventType);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(CANVAS_DND_MIME, eventType);
    e.dataTransfer.setData('text/plain', eventType);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={clearDragPayload}
      className={`
        flex items-center gap-1.5 px-1.5 py-1 rounded-md cursor-grab active:cursor-grabbing
        hover:bg-secondary/50 transition-colors text-[10px]
        ${isOnCanvas ? 'opacity-50' : ''}
      `}
      title={sourceFilter ? `${eventType} (${sourceFilter})` : eventType}
    >
      <span className="w-1 h-1 rounded-full bg-cyan-400 flex-shrink-0" />
      <span className="text-foreground/60 truncate">{eventType}</span>
      {isOnCanvas && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
    </div>
  );
}
