import { TrendingUp, Download } from 'lucide-react';
import { DimensionRadial } from '../../shared/DimensionRadial';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';
import { getCachedDesignResult } from '../cards/reviewParseCache';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { useTranslation } from '@/i18n/useTranslation';

interface TrendingCarouselProps {
  trendingTemplates: PersonaDesignReview[];
  onSelectTemplate: (template: PersonaDesignReview) => void;
}

export function TrendingCarousel({
  trendingTemplates,
  onSelectTemplate,
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
          <button
            key={tmpl.id}
            onClick={() => onSelectTemplate(tmpl)}
            className="flex-shrink-0 w-[200px] p-3 rounded-modal bg-emerald-500/5 border border-emerald-500/12 hover:border-emerald-500/25 hover:bg-emerald-500/10 transition-all text-left group/trend"
          >
            <div className="text-sm font-medium text-foreground group-hover/trend:text-emerald-300 truncate">
              {tmpl.test_case_name}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="inline-flex items-center gap-1 text-sm font-mono text-emerald-400/70">
                <Download className="w-2.5 h-2.5" />
                {tmpl.adoption_count}
              </span>
              <DimensionRadial designResult={getCachedDesignResult(tmpl)} size={20} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
