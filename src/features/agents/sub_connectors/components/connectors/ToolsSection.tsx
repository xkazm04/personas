import { useState } from 'react';
import { Wrench, ChevronDown, ChevronRight, Play } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';
import { ToolRunnerPanel } from '@/features/agents/sub_tool_runner';

interface ToolsSectionProps {
  tools: PersonaToolDefinition[];
  personaId?: string;
}

export function ToolsSection({ tools, personaId }: ToolsSectionProps) {
  const { t, tx } = useTranslation();
  const [toolsExpanded, setToolsExpanded] = useState(true);
  const [showRunner, setShowRunner] = useState(false);

  const invocableTools = tools.filter(
    (t) => t.script_path || t.implementation_guide,
  );

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/10 overflow-hidden">
      <button
        onClick={() => setToolsExpanded(!toolsExpanded)}
        aria-expanded={toolsExpanded}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/20 transition-colors focus-ring"
      >
        {toolsExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
        )}
        <Wrench className="w-3.5 h-3.5 text-muted-foreground/80" />
        <span className="text-sm font-medium text-muted-foreground/80">
          {tx(t.agents.connectors.ts_configured, { count: tools.length })}
        </span>
        {!toolsExpanded && tools.length > 0 && (
          <span className="text-sm text-muted-foreground/60 truncate flex-1">
            {tools.slice(0, 4).map((t) => t.name).join(', ')}{tools.length > 4 ? `, +${tools.length - 4}` : ''}
          </span>
        )}
      </button>

      {toolsExpanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="border-t border-primary/10 px-3.5 py-3 space-y-3">
              {tools.length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {tools.map((tool) => (
                      <span
                        key={tool.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-modal border border-primary/10 bg-secondary/20 text-foreground/80"
                        title={tool.description ?? undefined}
                      >
                        <Wrench className="w-3 h-3 text-muted-foreground/60" />
                        {tool.name}
                        {tool.requires_credential_type && (
                          <span className="text-sm text-muted-foreground/50">
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
                        aria-expanded={showRunner}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-modal border border-violet-500/25 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 transition-colors focus-ring"
                      >
                        <Play className="w-3 h-3" />
                        {showRunner ? t.agents.connectors.ts_hide_runner : tx(t.agents.connectors.ts_try_tools, { count: invocableTools.length })}
                      </button>

                      {showRunner && (
                          <div
                            className="animate-fade-slide-in overflow-hidden"
                          >
                            <ToolRunnerPanel tools={invocableTools} personaId={personaId} />
                          </div>
                        )}
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground/60">{t.agents.connectors.ts_no_tools}</p>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
