import { useState, useMemo } from 'react';
import { Bot, ChevronDown, ChevronRight, Search, Store } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import { setPendingItem } from '../hooks/useEventCanvasDragDrop';

type SidebarView = 'personas' | 'marketplace';

interface Props {
  personas: Persona[];
  triggers: PersonaTrigger[];
  onCanvasPersonaIds: Set<string>;
  onCanvasEventTypes: Set<string>;
  marketplaceContent: React.ReactNode;
  onStartPointerDrag: (type: 'event' | 'persona', value: string, label: string) => void;
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

export function PersonaPalette({ personas, triggers, onCanvasPersonaIds, onCanvasEventTypes, marketplaceContent, onStartPointerDrag }: Props) {
  const { t } = useTranslation();
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
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* View toggle */}
      <div className="flex items-center border-b border-primary/5 px-1.5 pt-2 pb-1.5 gap-1 flex-shrink-0">
        <button
          onClick={() => setView('personas')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold rounded-input transition-colors ${view === 'personas' ? 'bg-primary/10 text-primary' : 'text-foreground hover:text-foreground hover:bg-secondary/40'
            }`}
        >
          <Bot className="w-3 h-3" />{t.triggers.builder.personas}
        </button>
        <button
          onClick={() => setView('marketplace')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold rounded-input transition-colors ${view === 'marketplace' ? 'bg-primary/10 text-primary' : 'text-foreground hover:text-foreground hover:bg-secondary/40'
            }`}
        >
          <Store className="w-3 h-3" />{t.triggers.builder.marketplace}
        </button>
      </div>

      {view === 'marketplace' ? (
        <div className="flex-1 overflow-y-auto">{marketplaceContent}</div>
      ) : (
        <>
          <div className="px-2.5 pt-2.5 pb-1 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t.triggers.builder.filter_personas_placeholder}
                className="w-full pl-7 pr-2 py-1.5 text-xs rounded-input bg-secondary/50 border border-primary/10 text-foreground placeholder:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-1.5 pb-2">
            {filtered.map(p => {
              const isExpanded = expandedPersonas.has(p.id);
              const personaEvents = parseEventListenerTriggers(triggers, p.id);
              const hasEvents = personaEvents.length > 0;

              return (
                <div key={p.id} className="mt-0.5">
                  {/* Persona row — click sets pending, pointer-drag starts ghost */}
                  <div
                    onPointerDown={(e) => {
                      if (e.button === 0) {
                        e.preventDefault();
                        onStartPointerDrag('persona', p.id, p.name);
                      }
                    }}
                    onClick={() => setPendingItem('persona', p.id, p.name)}
                    className={`
                      flex items-center gap-2 px-2 py-[7px] rounded-card transition-colors group
                      cursor-grab active:cursor-grabbing hover:bg-secondary/60
                      ${onCanvasPersonaIds.has(p.id) ? 'opacity-50' : ''}
                      ${!p.enabled ? 'opacity-40' : ''}
                    `}
                    title={`Drag or click to place "${p.name}" on canvas`}
                  >
                    <div className="flex-shrink-0 icon-frame-sm bg-primary/5">
                      <PersonaIcon icon={p.icon} color={p.color} size="w-3 h-3" framed frameSize={"lg"} />
                    </div>
                    <span className="text-[11px] font-medium text-foreground truncate flex-1 min-w-0">{p.name}</span>
                    <div className="flex items-center gap-1 flex-shrink-0 min-w-[28px] justify-end">
                      {onCanvasPersonaIds.has(p.id) && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                      {hasEvents ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleExpanded(p.id); }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] text-foreground hover:text-foreground/70 hover:bg-secondary/50 transition-colors cursor-pointer"
                        >
                          <span>{personaEvents.length}</span>
                          {isExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Expanded events list */}
                  {hasEvents && (
                    <div
                      className="overflow-hidden transition-all duration-200 ease-in-out"
                      style={{ maxHeight: isExpanded ? personaEvents.length * 28 + 8 : 0, opacity: isExpanded ? 1 : 0 }}
                    >
                      <div className="ml-7 pl-2.5 border-l border-primary/8 pt-0.5 pb-1">
                        {personaEvents.map(ev => (
                          <div
                            key={ev.eventType}
                            onPointerDown={(e) => {
                              if (e.button === 0) {
                                e.preventDefault();
                                e.stopPropagation();
                                onStartPointerDrag('event', ev.eventType, ev.eventType);
                              }
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingItem('event', ev.eventType);
                            }}
                            className={`
                              flex items-center gap-1.5 px-1.5 py-1 rounded-input transition-colors text-[10px]
                              cursor-grab active:cursor-grabbing hover:bg-secondary/50
                              ${onCanvasEventTypes.has(ev.eventType) ? 'opacity-50' : ''}
                            `}
                            title={`Drag or click to place "${ev.eventType}" on canvas`}
                          >
                            <span className="w-1 h-1 rounded-full bg-cyan-400 flex-shrink-0" />
                            <span className="text-foreground truncate">{ev.eventType}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {filtered.length === 0 && (
              <p className="px-2 py-4 text-[10px] text-foreground italic text-center">
                {personas.length === 0 ? t.triggers.builder.no_personas_created : t.triggers.builder.no_matches}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
