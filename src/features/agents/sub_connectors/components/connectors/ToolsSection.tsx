import { useState } from 'react';
import { Wrench, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';

interface ToolsSectionProps {
  tools: PersonaToolDefinition[];
  personaId?: string;
}

export function ToolsSection({ tools }: ToolsSectionProps) {
  const { t, tx } = useTranslation();
  const [toolsExpanded, setToolsExpanded] = useState(true);

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/10 overflow-hidden">
      <button
        onClick={() => setToolsExpanded(!toolsExpanded)}
        aria-expanded={toolsExpanded}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/20 transition-colors focus-ring"
      >
        {toolsExpanded ? (
          <ChevronDown className="w-4 h-4 text-primary" />
        ) : (
          <ChevronRight className="w-4 h-4 text-primary" />
        )}
        <Wrench className="w-5 h-5 text-primary" />
        <span className="typo-submodule-header">
          {tx(t.agents.connectors.ts_configured, { count: tools.length })}
        </span>
        {!toolsExpanded && tools.length > 0 && (
          <span className="typo-body text-foreground truncate flex-1">
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
                <div className="flex flex-wrap gap-1.5">
                  {tools.map((tool) => (
                    <span
                      key={tool.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 typo-body rounded-modal border border-primary/10 bg-secondary/20 text-foreground"
                      title={tool.description ?? undefined}
                    >
                      <Wrench className="w-3 h-3 text-foreground" />
                      {tool.name}
                      {tool.requires_credential_type && (
                        <span className="typo-body text-foreground">
                          ({tool.requires_credential_type})
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="typo-body text-foreground">{t.agents.connectors.ts_no_tools}</p>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
