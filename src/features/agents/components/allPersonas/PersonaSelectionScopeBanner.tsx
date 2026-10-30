import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

interface PersonaSelectionScopeBannerProps {
  scope: 'none' | 'page' | 'matching';
  pageCount: number;
  matchingCount: number;
  onSelectAllMatching: () => void;
  onClear: () => void;
}

/**
 * Says how far a select-all reaches. The header checkbox selects the visible
 * page; this line offers the explicit step to every matching persona, and
 * once taken says so, so a bulk action's scope is never invisible.
 */
export function PersonaSelectionScopeBanner({
  scope, pageCount, matchingCount, onSelectAllMatching, onClear,
}: PersonaSelectionScopeBannerProps) {
  const { t, tx } = useTranslation();
  const pl = t.agents.persona_list;
  if (scope === 'none') return null;
  return (
    <div
      role="status"
      data-testid="roster-selection-scope"
      className="mx-3 my-1.5 flex items-center justify-center gap-2 rounded-card border border-primary/15 bg-primary/5 px-3 py-1.5 typo-body text-foreground"
    >
      {scope === 'page' ? (
        <>
          <span>{tx(pl.select_page_all_selected, { count: pageCount })}</span>
          <Button variant="link" size="sm" onClick={onSelectAllMatching}>
            {tx(pl.select_all_matching, { count: matchingCount })}
          </Button>
        </>
      ) : (
        <>
          <span>{tx(pl.all_matching_selected, { count: matchingCount })}</span>
          <Button variant="link" size="sm" onClick={onClear}>
            {pl.batch_clear}
          </Button>
        </>
      )}
    </div>
  );
}
