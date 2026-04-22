import { motion } from 'framer-motion';
import { Check, AlertCircle } from 'lucide-react';
import { CATEGORY_META, FALLBACK_CATEGORY } from '../QuestionnaireFormGridConfig';
import type { QuestionnaireCategoryProgress } from './types';

function CategoryNavItem({
  cat,
  progress,
  isCurrent,
  hasBlocked,
  onClick,
}: {
  cat: string;
  progress: QuestionnaireCategoryProgress;
  isCurrent: boolean;
  hasBlocked: boolean;
  onClick: () => void;
}) {
  const meta = CATEGORY_META[cat] ?? FALLBACK_CATEGORY;
  const { Icon } = meta;
  const complete = progress.pct === 1 && progress.total > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-card px-3 py-2.5 transition-all border ${
        isCurrent
          ? 'bg-foreground/[0.05] border-border'
          : 'bg-transparent border-transparent hover:bg-foreground/[0.03]'
      } ${meta.color}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${meta.color}`} />
        <span className={`flex-1 text-sm font-semibold truncate ${meta.color}`}>
          {meta.label}
        </span>
        {isCurrent && (
          <span className="text-xs uppercase tracking-wider text-primary font-semibold">
            here
          </span>
        )}
        {complete && !isCurrent && <Check className={`w-4 h-4 ${meta.color}`} />}
        {hasBlocked && !isCurrent && <AlertCircle className="w-4 h-4 text-status-error" />}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-foreground/[0.08] overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${
              hasBlocked
                ? 'bg-status-error/70'
                : complete
                  ? 'bg-status-success/80'
                  : 'bg-current'
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${progress.pct * 100}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
        <span className="text-xs text-foreground/60 font-mono tabular-nums">
          {progress.answered}/{progress.total}
        </span>
      </div>
    </button>
  );
}

/**
 * Left rail — compact category nav. Each row shows the category label,
 * an inline progress bar tinted with the category's colour token (or
 * status-success/error when complete/blocked), and the answered/total
 * fraction. Clicking a row jumps to the first unanswered question in
 * that category.
 */
export function QuestionnaireCategoryRail({
  categoryKeys,
  categoryProgress,
  categoryHasBlocked,
  currentCat,
  onJumpToCategory,
}: {
  categoryKeys: string[];
  categoryProgress: Record<string, QuestionnaireCategoryProgress>;
  categoryHasBlocked: Record<string, boolean>;
  currentCat: string;
  onJumpToCategory: (cat: string) => void;
}) {
  return (
    <aside className="w-[220px] flex-shrink-0 border-r border-border bg-foreground/[0.01] flex flex-col min-h-0">
      <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
        <span className="text-xs uppercase tracking-[0.2em] text-foreground/60 font-semibold">
          Categories
        </span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {categoryKeys.map((cat) => (
          <CategoryNavItem
            key={cat}
            cat={cat}
            progress={categoryProgress[cat]!}
            isCurrent={cat === currentCat}
            hasBlocked={!!categoryHasBlocked[cat]}
            onClick={() => onJumpToCategory(cat)}
          />
        ))}
      </nav>
    </aside>
  );
}
