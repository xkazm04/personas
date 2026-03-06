import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Bot, Zap, Clock } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { extractConnectorNames } from '@/lib/personas/utils';
import PersonaHoverPreview from './PersonaHoverPreview';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import { PersonaHealthIndicator } from './PersonaHealthIndicator';
import { WeeklyPerformanceReport } from '@/features/agents/sub_prompt_lab/WeeklyPerformanceReport';

export default function PersonaOverviewPage() {
  const personas = usePersonaStore(s => s.personas);
  const selectPersona = usePersonaStore(s => s.selectPersona);
  const triggerCounts = usePersonaStore(s => s.personaTriggerCounts);
  const lastRunMap = usePersonaStore(s => s.personaLastRun);
  const healthMap = usePersonaStore(s => s.personaHealthMap);
  const groups = usePersonaStore(s => s.groups);

  const groupColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of groups) map[g.id] = g.color;
    return map;
  }, [groups]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const gridRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleMouseEnter = useCallback((personaId: string) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoveredId(personaId), 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoveredId(null);
  }, []);

  useEffect(() => {
    const validIds = new Set(personas.map((p) => p.id));
    Object.keys(cardRefs.current).forEach((id) => {
      if (!validIds.has(id)) delete cardRefs.current[id];
    });
    if (hoveredId && !validIds.has(hoveredId)) {
      setHoveredId(null);
    }
    setActiveIndex((prev) => (personas.length === 0 ? 0 : Math.min(prev, personas.length - 1)));
  }, [personas, hoveredId]);

  const getGridColumns = useCallback((): number => {
    const grid = gridRef.current;
    if (!grid) return 1;
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, columns);
  }, []);

  const focusCardAt = useCallback((index: number) => {
    const persona = personas[index];
    if (!persona) return;
    setActiveIndex(index);
    cardRefs.current[persona.id]?.focus();
  }, [personas]);

  const handleCardKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (personas.length === 0) return;
    const cols = getGridColumns();
    let nextIndex: number;
    switch (e.key) {
      case 'ArrowRight':
        nextIndex = Math.min(personas.length - 1, index + 1);
        break;
      case 'ArrowLeft':
        nextIndex = Math.max(0, index - 1);
        break;
      case 'ArrowDown':
        nextIndex = Math.min(personas.length - 1, index + cols);
        break;
      case 'ArrowUp':
        nextIndex = Math.max(0, index - cols);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = personas.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    focusCardAt(nextIndex);
  }, [personas, getGridColumns, focusCardAt]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Bot className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="All Agents"
        subtitle={`${personas.length} agent${personas.length !== 1 ? 's' : ''} configured`}
      />

      <ContentBody>
      {/* Weekly Performance Report */}
      <div className="mb-4">
        <WeeklyPerformanceReport onNavigateToAgent={(id) => selectPersona(id)} />
      </div>

      <div ref={gridRef} role="grid" aria-label="Agent overview" className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {personas.map((persona, i) => {
          const connectors = extractConnectorNames(persona);
          const triggerCount = triggerCounts[persona.id];
          const lastRun = lastRunMap[persona.id];
          const groupColor = persona.group_id ? groupColorMap[persona.group_id] : undefined;
          const health: PersonaHealth | undefined = healthMap[persona.id];

          return (
            <motion.button
              key={persona.id}
              ref={(el) => { cardRefs.current[persona.id] = el; }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25, delay: Math.min(i, 12) * 0.04 }}
              whileHover={{ y: -2, transition: { duration: 0.15 } }}
              onClick={() => selectPersona(persona.id)}
              onFocus={() => setActiveIndex(i)}
              onKeyDown={(e) => handleCardKeyDown(e, i)}
              onMouseEnter={() => handleMouseEnter(persona.id)}
              onMouseLeave={handleMouseLeave}
              tabIndex={i === activeIndex ? 0 : -1}
              role="gridcell"
              data-testid={`persona-card-${persona.id}`}
              className="text-left p-4 rounded-xl border border-primary/10 bg-secondary/30 hover:bg-secondary/50 hover:border-primary/20 transition-all group"
              style={groupColor ? {
                borderLeftWidth: 3,
                borderImage: `linear-gradient(to bottom, ${groupColor}, transparent) 1`,
              } : undefined}
            >
              {/* Connector icons */}
              {connectors.length > 0 && (
                <div className="flex items-center gap-1 mb-2">
                  {connectors.map((name) => {
                    const meta = getConnectorMeta(name);
                    return (
                      <div
                        key={name}
                        className="w-5 h-5 rounded flex items-center justify-center"
                        style={{ backgroundColor: `${meta.color}15` }}
                        title={name}
                      >
                        <ConnectorIcon meta={meta} size="w-3 h-3" />
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-3 mb-2">
                <PersonaHealthIndicator persona={persona} health={health} />
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${persona.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/20'}`} />
                  <span className={`text-sm font-medium px-1.5 py-0.5 rounded-lg ${persona.enabled ? 'text-emerald-400 bg-emerald-500/10' : 'text-muted-foreground/80 bg-muted-foreground/10'}`}>
                    {persona.enabled ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              <h3 className="text-sm font-medium text-foreground/90 truncate">{persona.name}</h3>
              {persona.description && (
                <p className="text-sm text-muted-foreground/90 mt-1 line-clamp-2">{persona.description}</p>
              )}

              {/* Metadata row: triggers, last run, model */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {triggerCount != null && triggerCount > 0 && (
                  <span className="flex items-center gap-1 text-sm font-mono text-muted-foreground/80">
                    <Zap className="w-3 h-3" />
                    {triggerCount}
                  </span>
                )}
                {lastRun && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground/80">
                    <Clock className="w-3 h-3" />
                    {formatRelativeTime(lastRun)}
                  </span>
                )}
                {persona.model_profile && (
                  <span className="text-sm font-mono px-1.5 py-0.5 rounded-lg bg-primary/5 text-muted-foreground/80 truncate max-w-[100px]" title={persona.model_profile}>
                    {persona.model_profile}
                  </span>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Hover Preview Popover */}
      {hoveredId && (
        <PersonaHoverPreview
          personaId={hoveredId}
          triggerCount={triggerCounts[hoveredId]}
          anchorRef={{ current: cardRefs.current[hoveredId] ?? null }}
          visible
        />
      )}
      </ContentBody>
    </ContentBox>
  );
}
