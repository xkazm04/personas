import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Bot, Zap, Clock, AlertTriangle, Activity, Moon } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { extractConnectorNames } from '@/lib/personas/utils';
import PersonaHoverPreview from './PersonaHoverPreview';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useSimpleMode } from '@/hooks/utility/interaction/useSimpleMode';
import { PersonaHealthIndicator } from './PersonaHealthIndicator';
import { WeeklyPerformanceReport } from '@/features/agents/sub_prompt_lab';
import { useRelevanceSort, type ScoredPersona } from '../sidebar/useRelevanceSort';

const SECTION_META = {
  attention: {
    label: 'Needs Attention',
    icon: AlertTriangle,
    color: 'text-amber-400',
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/5',
  },
  active: {
    label: 'Active',
    icon: Activity,
    color: 'text-emerald-400',
    border: 'border-emerald-500/20',
    bg: 'bg-emerald-500/5',
  },
  idle: {
    label: 'Idle',
    icon: Moon,
    color: 'text-muted-foreground/60',
    border: 'border-primary/10',
    bg: 'bg-secondary/20',
  },
} as const;

export default function PersonaOverviewPage() {
  const personas = useAgentStore((s) => s.personas);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const triggerCounts = useAgentStore((s) => s.personaTriggerCounts);
  const lastRunMap = useAgentStore((s) => s.personaLastRun);
  const healthMap = useAgentStore((s) => s.personaHealthMap);
  const groups = usePipelineStore((s) => s.groups);

  const scored = useRelevanceSort(personas, healthMap, lastRunMap, triggerCounts);

  const groupColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of groups) map[g.id] = g.color;
    return map;
  }, [groups]);

  // Group scored personas into sections
  const sections = useMemo(() => {
    const result: { key: 'attention' | 'active' | 'idle'; items: ScoredPersona[] }[] = [];
    const buckets = { attention: [] as ScoredPersona[], active: [] as ScoredPersona[], idle: [] as ScoredPersona[] };
    for (const sp of scored) {
      buckets[sp.section].push(sp);
    }
    for (const key of ['attention', 'active', 'idle'] as const) {
      if (buckets[key].length > 0) {
        result.push({ key, items: buckets[key] });
      }
    }
    return result;
  }, [scored]);

  const isSimple = useSimpleMode();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [activeIndex, setActiveIndex] = useState(0);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => scored.map(s => s.persona), [scored]);

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
    setActiveIndex((prev) => (flatList.length === 0 ? 0 : Math.min(prev, flatList.length - 1)));
  }, [personas, hoveredId, flatList.length]);

  const focusCardAt = useCallback((index: number) => {
    const persona = flatList[index];
    if (!persona) return;
    setActiveIndex(index);
    cardRefs.current[persona.id]?.focus();
  }, [flatList]);

  const handleCardKeyDown = useCallback((e: React.KeyboardEvent, flatIndex: number) => {
    if (flatList.length === 0) return;
    let nextIndex: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = Math.min(flatList.length - 1, flatIndex + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = Math.max(0, flatIndex - 1);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = flatList.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    focusCardAt(nextIndex);
  }, [flatList, focusCardAt]);

  // Track flat index across sections
  let flatIndex = 0;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Bot className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={isSimple ? 'My Agents' : 'Agent Surface'}
        subtitle={isSimple ? `${personas.length} agent${personas.length !== 1 ? 's' : ''}` : `${personas.length} agent${personas.length !== 1 ? 's' : ''} \u2014 sorted by relevance`}
      />

      <ContentBody>
      {/* Weekly Performance Report (hidden in simple mode) */}
      {!isSimple && (
      <div className="mb-4">
        <WeeklyPerformanceReport onNavigateToAgent={(id) => selectPersona(id)} />
      </div>
      )}

      {sections.map(({ key, items }) => {
        const meta = SECTION_META[key];
        const Icon = meta.icon;
        const sectionStart = flatIndex;

        const sectionContent = (
          <div key={key} className="mb-6">
            {/* Section header */}
            <div className={`flex items-center gap-2 mb-3 px-1`}>
              <Icon className={`w-4 h-4 ${meta.color}`} />
              <h2 className={`text-sm font-semibold ${meta.color}`}>{meta.label}</h2>
              <span className="text-sm text-muted-foreground/80">({items.length})</span>
            </div>

            <div role="listbox" aria-label={`${meta.label} agents`} className={`grid gap-3 ${IS_MOBILE ? '[grid-template-columns:1fr]' : '[grid-template-columns:repeat(auto-fill,minmax(280px,1fr))] 3xl:[grid-template-columns:repeat(auto-fill,minmax(320px,1fr))] 4xl:[grid-template-columns:repeat(auto-fill,minmax(360px,1fr))]'}`}>
              {items.map((sp) => {
                const persona = sp.persona;
                const i = flatIndex++;
                const connectors = extractConnectorNames(persona);
                const triggerCount = triggerCounts[persona.id];
                const lastRun = lastRunMap[persona.id];
                const groupColor = persona.group_id ? groupColorMap[persona.group_id] : undefined;
                const health: PersonaHealth | undefined = healthMap[persona.id];
                const isIdle = key === 'idle';

                return (
                  <motion.button
                    key={persona.id}
                    ref={(el) => { cardRefs.current[persona.id] = el; }}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: isIdle ? 0.6 : 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25, delay: Math.min(i - sectionStart, 12) * 0.04 }}
                    whileHover={{ y: -2, opacity: 1, transition: { duration: 0.15 } }}
                    onClick={() => selectPersona(persona.id)}
                    onFocus={() => setActiveIndex(i)}
                    onKeyDown={(e) => handleCardKeyDown(e, i)}
                    onMouseEnter={() => handleMouseEnter(persona.id)}
                    onMouseLeave={handleMouseLeave}
                    tabIndex={i === activeIndex ? 0 : -1}
                    role="option"
                    aria-selected={i === activeIndex}
                    aria-label={`${persona.name}, ${persona.enabled ? 'active' : 'inactive'}${lastRun ? `, last run ${formatRelativeTime(lastRun)}` : ''}${triggerCount ? `, ${triggerCount} trigger${triggerCount !== 1 ? 's' : ''}` : ''}`}
                    data-testid={`persona-card-${persona.id}`}
                    className={`text-left p-4 rounded-xl border ${
                      key === 'attention'
                        ? 'border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/30'
                        : key === 'active'
                        ? 'border-emerald-500/10 bg-secondary/30 hover:bg-secondary/50 hover:border-emerald-500/20'
                        : 'border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/20'
                    } transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background`}
                    style={groupColor ? {
                      borderLeftWidth: 3,
                      borderImage: `linear-gradient(to bottom, ${groupColor}, transparent) 1`,
                    } : undefined}
                  >
                    {/* Connector icons (hidden in simple mode) */}
                    {!isSimple && connectors.length > 0 && (
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
                      {!isSimple && <PersonaHealthIndicator persona={persona} health={health} />}
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${persona.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/20'}`} />
                        <span className={`text-sm font-medium px-1.5 py-0.5 rounded-lg ${persona.enabled ? 'text-emerald-400 bg-emerald-500/10' : 'text-muted-foreground/80 bg-muted-foreground/10'}`}>
                          {persona.enabled ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    <h3 className="text-sm font-medium text-foreground/90 truncate" title={persona.name}>{persona.name}</h3>
                    {persona.description && (
                      <p className="text-sm text-muted-foreground/90 mt-1 line-clamp-2">{persona.description}</p>
                    )}

                    {/* Metadata row: triggers, last run, model (hidden in simple mode) */}
                    {!isSimple && (
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
                    )}
                  </motion.button>
                );
              })}
            </div>
          </div>
        );

        return sectionContent;
      })}

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
