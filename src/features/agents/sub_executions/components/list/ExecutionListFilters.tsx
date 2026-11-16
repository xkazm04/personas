import { ArrowLeftRight, X, FlaskConical } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

interface ExecutionListFiltersProps {
  showSimulations: boolean;
  setShowSimulations: (v: boolean) => void;
  hasSimulations: boolean;
  compareMode: boolean;
  exitCompareMode: () => void;
  setCompareMode: (v: boolean) => void;
  hasEnoughToCompare: boolean;
  compareLeft: string | null;
  compareRight: string | null;
  canCompare: boolean;
  onShowComparison: () => void;
}

export function ExecutionListFilters({
  showSimulations,
  setShowSimulations,
  hasSimulations,
  compareMode,
  exitCompareMode,
  setCompareMode,
  hasEnoughToCompare,
  compareLeft,
  compareRight,
  canCompare,
  onShowComparison,
}: ExecutionListFiltersProps) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  return (
    <>
      {hasSimulations && (
        <Tooltip content={e.simulations_filter_tooltip}>
          <Button
            type="button"
            onClick={() => setShowSimulations(!showSimulations)}
            variant={showSimulations ? 'secondary' : 'ghost'}
            size="xs"
            className="ml-auto"
            icon={<FlaskConical className="w-3 h-3" />}
          >{showSimulations ? e.hide_simulations : e.show_simulations}</Button>
        </Tooltip>
      )}
      {hasEnoughToCompare && (
        <Button
          type="button"
          onClick={() => compareMode ? exitCompareMode() : setCompareMode(true)}
          variant={compareMode ? 'secondary' : 'ghost'}
          size="xs"
          icon={compareMode ? <X className="w-3 h-3" /> : <ArrowLeftRight className="w-3 h-3" />}
        >{compareMode ? e.cancel : e.compare}</Button>
      )}

      {/* Compare mode toolbar */}
      {compareMode && (
        <div className="flex items-center gap-2 px-3 py-2 bg-surface-1 border border-hair rounded-modal typo-body col-span-full">
          <ArrowLeftRight className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
          <span className="text-ink-1">
            {!compareLeft
              ? e.select_first
              : !compareRight
                ? e.select_second
                : e.ready_to_compare}
          </span>
          {compareLeft && (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="typo-code text-primary">#{compareLeft.slice(0, 8)}</span>
              {compareRight && (
                <>
                  <span className="text-ink-1">{e.vs}</span>
                  <span className="typo-code text-primary">#{compareRight.slice(0, 8)}</span>
                </>
              )}
            </span>
          )}
          {canCompare && (
            <Button type="button" onClick={onShowComparison} variant="secondary" size="sm" className="ml-2">{e.compare}</Button>
          )}
        </div>
      )}
    </>
  );
}
