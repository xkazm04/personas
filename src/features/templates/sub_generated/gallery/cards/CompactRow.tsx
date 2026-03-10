import {
  CheckCircle2,
  Download,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { highlightMatch } from '@/lib/ui/highlightMatch';
import { getCategoryMeta } from '../search/filters/searchConstants';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { TemplateModal } from './reviewParseCache';
import type { ModalStackActions } from '../modals/useModalStack';

interface CompactRowProps {
  review: PersonaDesignReview;
  readinessScore: number;
  searchQuery: string;
  isAiResult: boolean;
  modals: ModalStackActions<TemplateModal>;
}

export function CompactRow({
  review,
  readinessScore,
  searchQuery,
  isAiResult,
  modals,
}: CompactRowProps) {
  const categoryMeta = review.category ? getCategoryMeta(review.category) : null;
  const CategoryIcon = categoryMeta?.icon ?? null;

  return (
    <div
      onClick={() => modals.open({ type: 'detail', review })}
      className="group flex items-center border-b border-primary/5 hover:bg-secondary/30 cursor-pointer transition-colors px-4 py-1.5"
      data-testid={`template-row-${review.id}`}
    >
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground/80 truncate">
          {highlightMatch(review.test_case_name, searchQuery)}
        </span>
        {isAiResult && (
          <span className="px-1.5 py-0.5 text-sm rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 flex-shrink-0">
            <Sparkles className="w-2.5 h-2.5 inline -mt-px mr-0.5" />AI
          </span>
        )}
        {categoryMeta && CategoryIcon && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-full bg-violet-500/8 border border-violet-500/15 text-muted-foreground/60 flex-shrink-0"
          >
            <CategoryIcon className="w-2.5 h-2.5" style={{ color: categoryMeta.color }} />
            {categoryMeta.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-2">
        <span
          className={`inline-flex items-center gap-1 text-sm font-mono ${
            readinessScore === 100
              ? 'text-emerald-400/80'
              : readinessScore > 0
                ? 'text-amber-400/70'
                : 'text-muted-foreground/40'
          }`}
          title={`${readinessScore}% ready`}
        >
          {readinessScore === 100 ? (
            <CheckCircle2 className="w-3 h-3" />
          ) : (
            <ShieldCheck className="w-3 h-3" />
          )}
          {readinessScore}%
        </span>
        {review.adoption_count > 0 && (
          <span className="inline-flex items-center gap-1 text-sm font-mono text-emerald-400/70">
            <Download className="w-2.5 h-2.5" />
            {review.adoption_count}
          </span>
        )}
      </div>
    </div>
  );
}
