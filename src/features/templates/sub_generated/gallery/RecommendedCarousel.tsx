import { Sparkles, Download } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

interface RecommendedCarouselProps {
  recommendedTemplates: PersonaDesignReview[];
  onSelectTemplate: (template: PersonaDesignReview) => void;
}

export function RecommendedCarousel({
  recommendedTemplates,
  onSelectTemplate,
}: RecommendedCarouselProps) {
  if (recommendedTemplates.length === 0) return null;

  return (
    <div className="px-4 py-3 border-b border-primary/10 flex-shrink-0">
      <div className="flex items-center gap-2 mb-2.5">
        <Sparkles className="w-4 h-4 text-amber-400/70" />
        <span className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wide">
          Recommended for You
        </span>
        <span className="text-sm text-muted-foreground/40">
          Based on your connectors
        </span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {recommendedTemplates.map((t) => {
          const connectors: string[] = parseJsonSafe(t.connectors_used, []);
          return (
            <button
              key={t.id}
              onClick={() => onSelectTemplate(t)}
              className="flex-shrink-0 w-[220px] p-3 rounded-xl bg-amber-500/5 border border-amber-500/12 hover:border-amber-500/25 hover:bg-amber-500/10 transition-all text-left group/rec"
            >
              <div className="text-sm font-medium text-foreground/80 group-hover/rec:text-amber-300 truncate">
                {t.test_case_name}
              </div>
              <div className="text-sm text-muted-foreground/50 truncate mt-0.5">
                {t.instruction.length > 55 ? t.instruction.slice(0, 55) + '...' : t.instruction}
              </div>
              <div className="flex items-center gap-2 mt-2">
                {connectors.slice(0, 3).map((c) => {
                  const meta = getConnectorMeta(c);
                  return (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded bg-secondary/40 text-muted-foreground/60"
                      title={meta.label}
                    >
                      <ConnectorIcon meta={meta} size="w-3 h-3" />
                      {meta.label.length > 8 ? meta.label.slice(0, 8) + '..' : meta.label}
                    </span>
                  );
                })}
                {connectors.length > 3 && (
                  <span className="text-sm text-muted-foreground/40">+{connectors.length - 3}</span>
                )}
                {t.adoption_count > 0 && (
                  <span className="ml-auto inline-flex items-center gap-1 text-sm font-mono text-emerald-400/60">
                    <Download className="w-2.5 h-2.5" />
                    {t.adoption_count}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
