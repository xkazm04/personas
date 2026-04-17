import {
  Download,
  Sparkles,
} from 'lucide-react';
import { highlightMatch } from '@/lib/ui/highlightMatch';
import { getCachedLightFields } from './reviewParseCache';
import { deriveArchCategories, userHasCategoryCredential } from '../matrix/architecturalCategories';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { TemplateModal } from './reviewParseCache';
import type { ModalStackActions } from '../modals/useModalStack';

interface CompactRowProps {
  review: PersonaDesignReview;
  searchQuery: string;
  isAiResult: boolean;
  modals: ModalStackActions<TemplateModal>;
  credentialServiceTypes: Set<string>;
}

export function CompactRow({
  review,
  searchQuery,
  isAiResult,
  modals,
  credentialServiceTypes,
}: CompactRowProps) {
  const { connectors } = getCachedLightFields(review);
  const archCategories = deriveArchCategories(connectors);

  return (
    <div
      onClick={() => modals.open({ type: 'detail', review })}
      className="group flex items-center border-b border-primary/5 hover:bg-secondary/30 cursor-pointer transition-colors px-4 py-1.5"
      data-testid={`template-row-${review.id}`}
    >
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="typo-body font-medium text-foreground truncate">
          {highlightMatch(review.test_case_name, searchQuery)}
        </span>
        {isAiResult && (
          <span className="px-1.5 py-0.5 typo-body rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 flex-shrink-0">
            <Sparkles className="w-2.5 h-2.5 inline -mt-px mr-0.5" />AI
          </span>
        )}
      </div>
      {/* Components */}
      <div className="flex items-center gap-1 flex-shrink-0 ml-2 mr-3">
        {archCategories.slice(0, 4).map((cat) => {
          const hasIt = userHasCategoryCredential(cat.key, credentialServiceTypes);
          const CatIcon = cat.icon;
          return (
            <div
              key={cat.key}
              className={`w-5.5 h-5.5 rounded flex items-center justify-center flex-shrink-0 ${
                hasIt ? '' : 'grayscale opacity-50'
              }`}
              style={{ backgroundColor: `${cat.color}15` }}
              title={`${cat.label}${hasIt ? ' (ready)' : ''}`}
            >
              <CatIcon className="w-3 h-3" style={{ color: cat.color }} />
            </div>
          );
        })}
        {archCategories.length > 4 && (
          <span className="text-[10px] text-foreground ml-0.5">+{archCategories.length - 4}</span>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {review.adoption_count > 0 && (
          <span className="inline-flex items-center gap-1 typo-code font-mono text-emerald-400/70">
            <Download className="w-2.5 h-2.5" />
            {review.adoption_count}
          </span>
        )}
      </div>
    </div>
  );
}
