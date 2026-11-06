import { Activity, Info } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { HealthcheckResultDisplay } from './HealthcheckResultDisplay';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface ConnectionTestSectionProps {
  onTest: () => void;
  isTesting?: boolean;
  /** `state` is the typed probe outcome; without it the display can only tell
   *  pass from fail and paints could-not-reach as a rejected key. */
  result?: { success: boolean; message: string; state?: string | null } | null;
  testHint?: string;
}

export function ConnectionTestSection({
  onTest,
  isTesting,
  result,
  testHint,
}: ConnectionTestSectionProps) {
  const { t } = useTranslation();
  const cf = t.vault.forms;

  return (
    <>
      <div className="border-t border-primary/8" />
      <div>
        <h4 className="typo-heading uppercase text-foreground mb-3">
          {cf.connection_test_heading}
        </h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTest}
            disabled={isTesting}
            data-testid="vault-test-connection"
            className={`flex items-center gap-2 px-4 py-2 border rounded-modal typo-body transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              result?.success
                ? 'bg-status-success/10 hover:bg-status-success/20 border-status-success/20 text-status-success'
                : 'bg-status-warning/10 hover:bg-status-warning/20 border-status-warning/25 text-status-warning'
            }`}
          >
            {isTesting ? (
              <LoadingSpinner />
            ) : (
              <Activity className="w-4 h-4" />
            )}
            {cf.test_connection_btn}
          </button>

          {testHint && (
            // The shared Tooltip opens on focus as well as hover, so the hint
            // is reachable by keyboard; the hand-rolled popover opened on
            // mouseenter only and the info button had no name.
            <Tooltip content={testHint} placement="right">
              <button
                type="button"
                aria-label={testHint}
                data-testid="vault-test-hint"
                className="p-1.5 rounded-full border border-hair text-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
        </div>

        {result && (
          <HealthcheckResultDisplay
            success={result.success}
            message={result.message}
            state={result.state}
          />
        )}
      </div>
    </>
  );
}
