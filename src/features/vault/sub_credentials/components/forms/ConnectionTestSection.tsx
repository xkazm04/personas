import { Activity, Info } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { HealthcheckResultDisplay } from './HealthcheckResultDisplay';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import Button from '@/features/shared/components/buttons/Button';

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
        <h4 className="typo-eyebrow text-foreground mb-3">
          {cf.connection_test_heading}
        </h4>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={onTest}
            disabled={isTesting}
            data-testid="vault-test-connection"
            variant={result?.success ? 'accent' : 'accent'}
            tone={result?.success ? 'success' : 'warning'}
            size="md"
            icon={isTesting ? (
              <LoadingSpinner />
            ) : (
              <Activity className="w-4 h-4" />
            )}
          >
            {cf.test_connection_btn}
          </Button>

          {testHint && (
            // The shared Tooltip opens on focus as well as hover, so the hint
            // is reachable by keyboard; the hand-rolled popover opened on
            // mouseenter only and the info button had no name.
            <Tooltip content={testHint} placement="right">
              <Button
                type="button"
                aria-label={testHint}
                data-testid="vault-test-hint"
                variant="secondary"
                size="icon-sm"
              >
                <Info className="w-3.5 h-3.5" />
              </Button>
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
