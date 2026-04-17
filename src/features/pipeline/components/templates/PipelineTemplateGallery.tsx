import { useState } from 'react';
import { Zap, ChevronRight, LayoutTemplate } from 'lucide-react';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { PipelineTemplate } from './pipelineTemplateTypes';
import { EDGE_COLORS, NODE_ROLE_FILLS } from './pipelineTemplateTypes';
import { PIPELINE_TEMPLATES } from './pipelineTemplateData';
import { MiniCanvas, RoleBadge } from './MiniCanvas';
import { useTranslation } from '@/i18n/useTranslation';

// Re-export for consumers that import from this file
export type { PipelineTemplate } from './pipelineTemplateTypes';
export { PIPELINE_TEMPLATES } from './pipelineTemplateData';

// ============================================================================
// Gallery Component
// ============================================================================

interface PipelineTemplateGalleryProps {
  onAdopt: (template: PipelineTemplate) => void;
}

export default function PipelineTemplateGallery({ onAdopt }: PipelineTemplateGalleryProps) {
  const { t } = useTranslation();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-4">
        <LayoutTemplate className="w-4 h-4 text-indigo-400/60" />
        <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wider">{t.pipeline.starter_templates}</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {PIPELINE_TEMPLATES.map((tpl, _i) => {
          const isHovered = hoveredId === tpl.id;
          const isExpanded = expandedId === tpl.id;

          return (
            <div
              key={tpl.id}
              className="animate-fade-slide-in relative group"
            >
              <div
                className={`rounded-modal border transition-all duration-200 cursor-pointer overflow-hidden ${
                  isExpanded
                    ? 'bg-secondary/50 border-indigo-500/25 shadow-[0_0_16px_rgba(99,102,241,0.06)]'
                    : 'bg-secondary/30 border-primary/10 hover:border-indigo-500/20 hover:bg-secondary/40'
                }`}
                onMouseEnter={() => setHoveredId(tpl.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => setExpandedId(isExpanded ? null : tpl.id)}
              >
                {/* Top accent */}
                <div
                  className="h-[2px] opacity-50"
                  style={{ backgroundColor: tpl.color }}
                />

                <div className="p-3">
                  {/* Header row */}
                  <div className="flex items-start gap-3">
                    {/* Mini canvas */}
                    <div className="rounded-card bg-background/40 border border-primary/8 p-1">
                      <MiniCanvas template={tpl} hovered={isHovered || isExpanded} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-base leading-none">{tpl.icon}</span>
                        <h3 className="text-sm font-semibold text-foreground/90 truncate">{tpl.name}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground/80 line-clamp-2 leading-relaxed">
                        {tpl.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 text-sm text-muted-foreground/60 font-mono">
                        <span>{tpl.nodes.length} {t.pipeline.nodes}</span>
                        <span className="opacity-40">·</span>
                        <span>{tpl.edges.length} {t.pipeline.edges}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                    <div
                      className="animate-fade-slide-in overflow-hidden"
                    >
                      <div className="px-3 pb-3 pt-1 border-t border-primary/8">
                        {/* Node list */}
                        <div className="space-y-1 mb-3">
                          {tpl.nodes.map((node) => (
                            <div key={node.id} className="flex items-center gap-2">
                              <div
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: NODE_ROLE_FILLS[node.role] || '#6366f1' }}
                              />
                              <span className="text-sm text-foreground/80 truncate">{node.label}</span>
                              <RoleBadge role={node.role} />
                            </div>
                          ))}
                        </div>

                        {/* Connection legend */}
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {[...new Set(tpl.edges.map((e) => e.type))].map((type) => (
                            <span
                              key={type}
                              className="inline-flex items-center gap-1 text-sm font-mono px-1.5 py-0.5 rounded bg-background/40 border border-primary/8"
                            >
                              <span
                                className="w-3 h-[2px] rounded-full inline-block"
                                style={{ backgroundColor: EDGE_COLORS[type] }}
                              />
                              <span className="text-muted-foreground/70">{type}</span>
                            </span>
                          ))}
                        </div>

                        {/* Adopt button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onAdopt(tpl);
                          }}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-modal text-sm font-medium transition-all"
                          style={{
                            backgroundColor: colorWithAlpha(tpl.color, 0.09),
                            borderColor: colorWithAlpha(tpl.color, 0.19),
                            color: tpl.color,
                            border: '1px solid',
                          }}
                        >
                          <Zap className="w-3.5 h-3.5" />
                          {t.pipeline.use_template}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
