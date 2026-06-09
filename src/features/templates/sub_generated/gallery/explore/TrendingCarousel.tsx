import { TrendingUp, Download } from 'lucide-react';
import { DimensionRadial } from '../../shared/DimensionRadial';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { getCachedDesignResult } from '../cards/reviewParseCache';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { useTranslation } from '@/i18n/useTranslation';

interface TrendingCarouselProps {
  trendingTemplates: PersonaDesignReview[];
  onSelectTemplate: (template: PersonaDesignReview) => void;
  /** Hover-revealed quick-adopt — opens the adoption flow directly from the shelf. */
  onAdoptTemplate?: (template: PersonaDesignReview) => void;
}

export function TrendingCarousel({
  trendingTemplates,
  onSelectTemplate,
  onAdoptTemplate,
}: TrendingCarouselProps) {
  const { t } = useTranslation();
  if (trendingTemplates.length === 0) return null;

  return (
    <div className="px-4 py-3 border-b border-primary/10 flex-shrink-0">
      <div className="flex items-center gap-2 mb-2.5">
        <TrendingUp className="w-4 h-4 text-emerald-400/70" />
        <SectionLabel as="span" className="mb-0">
          {t.templates.trending.title}
        </SectionLabel>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {trendingTemplates.map((tmpl) => (
          // Relative wrapper so the quick-adopt action can be a SIBLING of the
          // card button (nested buttons are invalid HTML) while still sharing
          // one hover group.
          <div key={tmpl.id} className="relative flex-shrink-0 group/trend">
            <button
              onClick={() => onSelectTemplate(tmpl)}
              className="w-[200px] p-3 rounded-modal bg-emerald-500/5 border border-emerald-500/12 hover:border-emerald-500/25 group-hover/trend:bg-emerald-500/10 transition-all text-left"
            >
              <div className="typo-body font-medium text-foreground group-hover/trend:text-emerald-300 truncate pr-7">
                {tmpl.test_case_name}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="inline-flex items-center gap-1 typo-code font-mono text-emerald-400/70">
                  <Download className="w-2.5 h-2.5" />
                  {tmpl.adoption_count}
                </span>
                <DimensionRadial designResult={getCachedDesignResult(tmpl)} size={20} />
              </div>
            </button>
            {onAdoptTemplate && (
              <Tooltip content={t.templates.actions.adopt} placement="bottom">
                <button
                  onClick={() => onAdoptTemplate(tmpl)}
                  aria-label={t.templates.actions.adopt}
                  data-testid={`trending-adopt-${tmpl.id}`}
                  className="absolute top-2 right-2 p-1.5 rounded-interactive bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 opacity-0 group-hover/trend:opacity-100 focus-visible:opacity-100 hover:bg-emerald-500/25 transition-all outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
