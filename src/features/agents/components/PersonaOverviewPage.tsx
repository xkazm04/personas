import { motion } from 'framer-motion';
import { Bot, Zap, Clock } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

export default function PersonaOverviewPage() {
  const personas = usePersonaStore(s => s.personas);
  const selectPersona = usePersonaStore(s => s.selectPersona);
  const triggerCounts = usePersonaStore(s => s.personaTriggerCounts);
  const lastRunMap = usePersonaStore(s => s.personaLastRun);

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-6 py-5 border-b border-primary/10 bg-primary/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <Bot className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground/90">All Agents</h1>
            <p className="text-xs text-muted-foreground/50">{personas.length} agent{personas.length !== 1 ? 's' : ''} configured</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full p-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {personas.map((persona, i) => {
          const connectors = (() => {
            if (!persona.last_design_result) return [];
            try {
              const dr = JSON.parse(persona.last_design_result) as DesignAnalysisResult;
              return (dr.suggested_connectors ?? []).map(c => typeof c === 'string' ? c : c.name).slice(0, 4);
            } catch {
              return [];
            }
          })();
          const triggerCount = triggerCounts[persona.id];
          const lastRun = lastRunMap[persona.id];

          return (
            <motion.button
              key={persona.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25, delay: i * 0.05 }}
              whileHover={{ y: -2, transition: { duration: 0.15 } }}
              onClick={() => selectPersona(persona.id)}
              className="text-left p-4 rounded-xl border border-primary/10 bg-secondary/30 hover:bg-secondary/50 hover:border-primary/20 transition-all group"
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
                {persona.icon ? (
                  persona.icon.startsWith('http') ? (
                    <img src={persona.icon} alt="" className="w-8 h-8" />
                  ) : (
                    <span className="text-2xl">{persona.icon}</span>
                  )
                ) : (
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: (persona.color || '#8b5cf6') + '20' }}>
                    <Bot className="w-4 h-4" style={{ color: persona.color || '#8b5cf6' }} />
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${persona.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/20'}`} />
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${persona.enabled ? 'text-emerald-400 bg-emerald-500/10' : 'text-muted-foreground/40 bg-muted-foreground/10'}`}>
                    {persona.enabled ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              <h3 className="text-sm font-medium text-foreground/90 truncate">{persona.name}</h3>
              {persona.description && (
                <p className="text-xs text-muted-foreground/50 mt-1 line-clamp-2">{persona.description}</p>
              )}

              {/* Metadata row: triggers, last run, model */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {triggerCount != null && triggerCount > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/40">
                    <Zap className="w-3 h-3" />
                    {triggerCount}
                  </span>
                )}
                {lastRun && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40">
                    <Clock className="w-3 h-3" />
                    {formatRelativeTime(lastRun)}
                  </span>
                )}
                {persona.model_profile && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-primary/5 text-muted-foreground/40 truncate max-w-[100px]" title={persona.model_profile}>
                    {persona.model_profile}
                  </span>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
        </div>
      </div>
    </div>
  );
}
