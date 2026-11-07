import { useState } from 'react';
import { Wrench, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PressSurface } from '@/features/shared/components/buttons';

interface ToolsSectionProps {
  tools: PersonaToolDefinition[];
}

export function ToolsSection({ tools }: ToolsSectionProps) {
  const { t, tx } = useTranslation();
  const [toolsExpanded, setToolsExpanded] = useState(true);

  return (
    <div className="rounded-modal border border-hair bg-surface-1 overflow-hidden">
      <PressSurface
        onPress={() => setToolsExpanded(!toolsExpanded)}
        aria-expanded={toolsExpanded}
        className="w-full flex items-center gap-2 px-3.5 py-2.5"
      >
        {toolsExpanded ? (
          <ChevronDown className="w-4 h-4 text-ink-3" />
        ) : (
          <ChevronRight className="w-4 h-4 text-ink-3" />
        )}
        <Wrench className="w-5 h-5 text-ink-3" />
        <span className="typo-submodule-header">
          {tx(t.agents.connectors.ts_configured, { count: tools.length })}
        </span>
        {!toolsExpanded && tools.length > 0 && (
          <span className="typo-body text-ink-2 truncate flex-1">
            {tools.slice(0, 4).map((t) => t.name).join(', ')}{tools.length > 4 ? `, +${tools.length - 4}` : ''}
          </span>
        )}
      </PressSurface>

      {toolsExpanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="border-t border-hair px-3.5 py-3 space-y-3">
              {tools.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {tools.map((tool) => (
                    <Tooltip content={tool.description ?? undefined}><span
                      key={tool.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 typo-body rounded-modal border border-hair bg-surface-1 text-ink-1">
                      <Wrench className="w-3 h-3 text-ink-1" />
                      {tool.name}
                      {tool.requires_credential_type && (
                        <span className="typo-body text-ink-1">
                          ({tool.requires_credential_type})
                        </span>
                      )}
                    </span></Tooltip>
                  ))}
                </div>
              ) : (
                <p className="typo-body text-ink-1">{t.agents.connectors.ts_no_tools}</p>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
