import { useState } from 'react';
import { Activity, Info } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { HealthcheckResultDisplay } from './HealthcheckResultDisplay';

interface ConnectionTestSectionProps {
  onTest: () => void;
  isTesting?: boolean;
  result?: { success: boolean; message: string } | null;
  testHint?: string;
}

export function ConnectionTestSection({
  onTest,
  isTesting,
  result,
  testHint,
}: ConnectionTestSectionProps) {
  const [showTestHint, setShowTestHint] = useState(false);

  return (
    <>
      <div className="border-t border-primary/8" />
      <div>
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
          Connection Test
        </h4>
        <div className="flex items-center gap-2">
          <button
            onClick={onTest}
            disabled={isTesting}
            className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              result?.success
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20 text-emerald-400'
                : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/25 text-amber-300'
            }`}
          >
            {isTesting ? (
              <LoadingSpinner />
            ) : (
              <Activity className="w-4 h-4" />
            )}
            Test Connection
          </button>

          {testHint && (
            <div
              className="relative"
              onMouseEnter={() => setShowTestHint(true)}
              onMouseLeave={() => setShowTestHint(false)}
            >
              <button
                type="button"
                className="p-1.5 rounded-full border border-primary/15 text-muted-foreground/80 hover:text-foreground hover:bg-secondary/40 transition-colors"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
              {showTestHint && (
                <div className="absolute left-8 top-1/2 -translate-y-1/2 w-72 px-3 py-2 rounded-xl bg-background border border-primary/20 shadow-elevation-3 text-sm text-foreground/85 z-20">
                  {testHint}
                </div>
              )}
            </div>
          )}
        </div>

        {result && (
          <HealthcheckResultDisplay
            success={result.success}
            message={result.message}
          />
        )}
      </div>
    </>
  );
}
