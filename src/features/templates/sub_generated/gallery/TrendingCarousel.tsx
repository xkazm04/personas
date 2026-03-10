import { TrendingUp, Download } from 'lucide-react';
import { DimensionRadial } from '../shared/DimensionRadial';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
<<<<<<< HEAD
import type { AgentIR } from '@/lib/types/designTypes';
=======
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

interface TrendingCarouselProps {
  trendingTemplates: PersonaDesignReview[];
  onSelectTemplate: (template: PersonaDesignReview) => void;
}

export function TrendingCarousel({
  trendingTemplates,
  onSelectTemplate,
}: TrendingCarouselProps) {
  if (trendingTemplates.length === 0) return null;

  return (
    <div className="px-4 py-3 border-b border-primary/10 flex-shrink-0">
      <div className="flex items-center gap-2 mb-2.5">
        <TrendingUp className="w-4 h-4 text-emerald-400/70" />
        <span className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wide">
          Most Adopted This Week
        </span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {trendingTemplates.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelectTemplate(t)}
            className="flex-shrink-0 w-[200px] p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/12 hover:border-emerald-500/25 hover:bg-emerald-500/10 transition-all text-left group/trend"
          >
            <div className="text-sm font-medium text-foreground/80 group-hover/trend:text-emerald-300 truncate">
              {t.test_case_name}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="inline-flex items-center gap-1 text-sm font-mono text-emerald-400/70">
                <Download className="w-2.5 h-2.5" />
                {t.adoption_count}
              </span>
<<<<<<< HEAD
              <DimensionRadial designResult={parseJsonSafe<AgentIR | null>(t.design_result, null)} size={20} />
=======
              <DimensionRadial designResult={parseJsonSafe<DesignAnalysisResult | null>(t.design_result, null)} size={20} />
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
