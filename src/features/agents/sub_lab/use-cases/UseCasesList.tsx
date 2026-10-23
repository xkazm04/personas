import { useMemo } from 'react';
import { ListChecks } from 'lucide-react';
import { AnimatedList } from '@/features/shared/components/display/AnimatedList';
import { useTranslation } from '@/i18n/useTranslation';
import { STATUS_PALETTE_EXTENDED } from '@/lib/design/statusTokens';
import { parseDesignContext } from '@/features/agents/shared/designContext';

// -- Re-exports for the use-cases siblings ---------------------------
// These types are canonically defined in frontendTypes.ts. The design_context
// parser that used to live here is now `@/features/agents/shared/designContext`.
export type { DesignUseCase as UseCaseItem } from '@/lib/types/frontendTypes';
export type { UseCaseInputField } from '@/lib/types/frontendTypes';

// -- Component -------------------------------------------------------

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  notification:   { bg: `${STATUS_PALETTE_EXTENDED.critical.bg} ${STATUS_PALETTE_EXTENDED.critical.border}`, text: `${STATUS_PALETTE_EXTENDED.critical.text}/70` },
  'data-sync':    { bg: `${STATUS_PALETTE_EXTENDED.rotation.bg} ${STATUS_PALETTE_EXTENDED.rotation.border}`, text: `${STATUS_PALETTE_EXTENDED.rotation.text}/70` },
  monitoring:     { bg: `${STATUS_PALETTE_EXTENDED.warning.bg} ${STATUS_PALETTE_EXTENDED.warning.border}`,   text: `${STATUS_PALETTE_EXTENDED.warning.text}/70` },
  automation:     { bg: `${STATUS_PALETTE_EXTENDED.ai.bg} ${STATUS_PALETTE_EXTENDED.ai.border}`,             text: `${STATUS_PALETTE_EXTENDED.ai.text}/70` },
  communication:  { bg: `${STATUS_PALETTE_EXTENDED.info.bg} ${STATUS_PALETTE_EXTENDED.info.border}`,         text: `${STATUS_PALETTE_EXTENDED.info.text}/70` },
  reporting:      { bg: `${STATUS_PALETTE_EXTENDED.success.bg} ${STATUS_PALETTE_EXTENDED.success.border}`,   text: `${STATUS_PALETTE_EXTENDED.success.text}/70` },
};

interface UseCasesListProps {
  designContext: string | null | undefined;
  /** Empty state message when no structured use cases */
  emptyMessage?: string;
  /** Sub-message below empty state */
  emptyHint?: string;
}

export function UseCasesList({ designContext, emptyMessage, emptyHint }: UseCasesListProps) {
  const { t } = useTranslation();
  const contextData = useMemo(() => parseDesignContext(designContext), [designContext]);
  const useCases = contextData.useCases ?? [];

  if (useCases.length === 0) {
    return (
      <div className="text-center py-8 space-y-2">
        <ListChecks className="w-5 h-5 text-foreground mx-auto" />
        <p className="typo-body text-foreground">
          {emptyMessage ?? (designContext ? 'No structured use cases found.' : 'No use cases generated yet.')}
        </p>
        {emptyHint && (
          <p className="typo-body text-foreground">{emptyHint}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <ListChecks className="w-3.5 h-3.5 text-foreground" />
        <p className="typo-body text-foreground">
          {useCases.length} {t.shared.use_cases_extra.use_case_singular}{useCases.length !== 1 ? 's' : ''} identified
        </p>
      </div>

      <AnimatedList
        className="space-y-2"
        keys={useCases.map((uc, i) => uc.id || String(i))}
      >
        {useCases.map((uc, i) => {
          const catStyle = uc.category ? CATEGORY_STYLES[uc.category] : null;
          return (
            <div
              key={uc.id || i}
              className="p-3.5 rounded-xl border border-primary/10 bg-secondary/20"
            >
              <div className="flex items-start gap-3">
                <span className="typo-heading text-foreground mt-0.5 w-5 text-right flex-shrink-0">
                  {i + 1}.
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="typo-heading text-foreground/95">{uc.title}</p>
                    {uc.category && catStyle && (
                      <span className={`px-1.5 py-0.5 typo-label rounded border ${catStyle.bg} ${catStyle.text}`}>
                        {uc.category.replace('-', ' ')}
                      </span>
                    )}
                  </div>
                  <p className="typo-body text-foreground mt-1">
                    {uc.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </AnimatedList>

      {contextData.summary && (
        <div className="px-1 mt-2">
          <p className="typo-body text-foreground">
            {contextData.summary}
          </p>
        </div>
      )}
    </div>
  );
}
