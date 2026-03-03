import { useState } from 'react';
import { Wrench, ChevronDown, ChevronRight, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';
import { ToolRunnerPanel } from '@/features/agents/sub_tool_runner/ToolRunnerPanel';

interface ToolsSectionProps {
  tools: PersonaToolDefinition[];
  personaId?: string;
}

export function ToolsSection({ tools, personaId }: ToolsSectionProps) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [showRunner, setShowRunner] = useState(false);

  const invocableTools = tools.filter(
    (t) => t.script_path || t.implementation_guide,
  );

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden">
      <button
        onClick={() => setToolsExpanded(!toolsExpanded)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/20 transition-colors"
      >
        {toolsExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
        )}
        <Wrench className="w-3.5 h-3.5 text-muted-foreground/80" />
        <span className="text-sm font-medium text-muted-foreground/80">
          {tools.length} tool{tools.length !== 1 ? 's' : ''} configured
        </span>
        {!toolsExpanded && tools.length > 0 && (
          <span className="text-sm text-muted-foreground/40 truncate flex-1">
            {tools.slice(0, 4).map((t) => t.name).join(', ')}{tools.length > 4 ? `, +${tools.length - 4}` : ''}
          </span>
        )}
      </button>

      <AnimatePresence>
        {toolsExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="border-t border-primary/10 px-3.5 py-3 space-y-3">
              {tools.length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {tools.map((tool) => (
                      <span
                        key={tool.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-lg border border-primary/10 bg-secondary/20 text-foreground/80"
                        title={tool.description ?? undefined}
                      >
                        <Wrench className="w-3 h-3 text-muted-foreground/60" />
                        {tool.name}
                        {tool.requires_credential_type && (
                          <span className="text-[10px] text-muted-foreground/50">
                            ({tool.requires_credential_type})
                          </span>
                        )}
                      </span>
                    ))}
                  </div>

                  {invocableTools.length > 0 && personaId && (
                    <>
                      <button
                        onClick={() => setShowRunner(!showRunner)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-violet-500/25 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 transition-colors"
                      >
                        <Play className="w-3 h-3" />
                        {showRunner ? 'Hide Tool Runner' : `Try Tools (${invocableTools.length})`}
                      </button>

                      <AnimatePresence>
                        {showRunner && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            <ToolRunnerPanel tools={invocableTools} personaId={personaId} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground/60">No tools configured.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
