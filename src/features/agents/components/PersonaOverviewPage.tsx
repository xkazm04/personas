import { useState, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Bot, Zap, Clock } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { extractConnectorNames } from '@/lib/personas/utils';
import PersonaHoverPreview from './PersonaHoverPreview';

type HealthLevel = 'healthy' | 'mixed' | 'failing' | 'inactive';

function deriveHealth(statuses: string[] | undefined): HealthLevel {
  if (!statuses || statuses.length === 0) return 'inactive';
  const failures = statuses.filter((s) => s === 'failed' || s === 'error').length;
  const ratio = failures / statuses.length;
  if (ratio === 0) return 'healthy';
  if (ratio >= 0.6) return 'failing';
  return 'mixed';
}

const HEALTH_RING_CLASS: Record<HealthLevel, string> = {
  healthy: 'ring-2 ring-emerald-400/40',
  mixed: 'border-2 border-dashed border-amber-400/40',
  failing: 'ring-2 ring-red-400/50',
  inactive: 'border-2 border-dashed border-muted-foreground/15',
};

const HEALTH_DOT_COLOR: Record<string, string> = {
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
  error: 'bg-red-400',
  cancelled: 'bg-amber-400',
  running: 'bg-blue-400',
};

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

  const handleMouseEnter = useCallback((personaId: string) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoveredId(personaId), 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoveredId(null);
  }, []);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Bot className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="All Agents"
        subtitle={`${personas.length} agent${personas.length !== 1 ? 's' : ''} configured`}
      />

      <ContentBody>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {personas.map((persona, i) => {
          const connectors = extractConnectorNames(persona);
          const triggerCount = triggerCounts[persona.id];
          const lastRun = lastRunMap[persona.id];
          const groupColor = persona.group_id ? groupColorMap[persona.group_id] : undefined;

          return (
            <motion.button
              key={persona.id}
              ref={(el) => { cardRefs.current[persona.id] = el; }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25, delay: i * 0.05 }}
              whileHover={{ y: -2, transition: { duration: 0.15 } }}
              onClick={() => selectPersona(persona.id)}
              onMouseEnter={() => handleMouseEnter(persona.id)}
              onMouseLeave={handleMouseLeave}
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
                {/* Icon with health ring */}
                {(() => {
                  const health = deriveHealth(healthMap[persona.id]);
                  const ringClass = HEALTH_RING_CLASS[health];
                  const statuses = healthMap[persona.id];
                  return (
                    <div className="relative group/health">
                      <div className={`rounded-lg ${ringClass}`}>
                        {persona.icon ? (
                          persona.icon.startsWith('http') ? (
                            <img src={persona.icon} alt="" className="w-8 h-8" />
                          ) : (
                            <span className="text-2xl leading-8 w-8 h-8 flex items-center justify-center">{persona.icon}</span>
                          )
                        ) : (
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: (persona.color || '#8b5cf6') + '20' }}>
                            <Bot className="w-4 h-4" style={{ color: persona.color || '#8b5cf6' }} />
                          </div>
                        )}
                      </div>
                      {/* Health tooltip on hover */}
                      {statuses && statuses.length > 0 && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/health:flex items-center gap-1 px-2 py-1.5 rounded-lg bg-popover border border-primary/15 shadow-lg z-20 whitespace-nowrap">
                          {statuses.map((s, si) => (
                            <div
                              key={si}
                              className={`w-2 h-2 rounded-full ${HEALTH_DOT_COLOR[s] ?? 'bg-muted-foreground/30'}`}
                              title={s}
                            />
                          ))}
                          <span className="text-sm text-muted-foreground/90 ml-1">last {statuses.length}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${persona.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/20'}`} />
                  <span className={`text-sm font-medium px-1.5 py-0.5 rounded-md ${persona.enabled ? 'text-emerald-400 bg-emerald-500/10' : 'text-muted-foreground/80 bg-muted-foreground/10'}`}>
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
                  <span className="text-sm font-mono px-1.5 py-0.5 rounded-md bg-primary/5 text-muted-foreground/80 truncate max-w-[100px]" title={persona.model_profile}>
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
