import { useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Save, Database } from 'lucide-react';
import { createLogger } from '@/lib/log';

const logger = createLogger('auto-cred-review');
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { savePlaywrightProcedure } from '@/api/vault/autoCredBrowser';
import { useTranslation } from '@/i18n/useTranslation';

interface ReviewHealthcheckProps {
  onHealthcheck: () => void;
  healthResult: { success: boolean; message: string } | null;
}

export function ReviewHealthcheck({ onHealthcheck, healthResult }: ReviewHealthcheckProps) {
  const [isHealthchecking, setIsHealthchecking] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={async () => {
          setIsHealthchecking(true);
          try {
            await Promise.resolve(onHealthcheck());
          } finally {
            setIsHealthchecking(false);
          }
        }}
        disabled={isHealthchecking}
        className="flex items-center gap-1.5 px-3 py-1.5 typo-body rounded-modal border border-primary/15 hover:bg-secondary/40 text-foreground hover:text-foreground transition-colors"
      >
        {isHealthchecking ? <LoadingSpinner size="sm" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {isHealthchecking ? 'Testing...' : 'Test Connection'}
      </button>
      {healthResult && (
        <div className={`flex items-center gap-1.5 typo-body ${healthResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
          {healthResult.success ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <XCircle className="w-3.5 h-3.5" />
          )}
          {healthResult.message}
        </div>
      )}
    </div>
  );
}

interface ReviewActionButtonsProps {
  onSave: () => void;
  onRetry: () => void;
  onCancel: () => void;
  isSaving: boolean;
  healthResult: { success: boolean; message: string } | null;
  extractedValues: Record<string, string>;
  connectorName: string;
}

export function ReviewActionButtons({
  onSave,
  onRetry,
  onCancel,
  isSaving,
  healthResult,
  extractedValues,
  connectorName,
}: ReviewActionButtonsProps) {
  const { t } = useTranslation();
  const isDev = import.meta.env.DEV;
  const [savingProcedure, setSavingProcedure] = useState(false);
  const [procedureSaved, setProcedureSaved] = useState(false);

  const handleSaveProcedure = async () => {
    const procedureLog = extractedValues.__procedure_log ?? '';
    if (!procedureLog) return;
    setSavingProcedure(true);
    try {
      const fieldKeys = JSON.stringify(
        Object.keys(extractedValues).filter((k) => !k.startsWith('__')),
      );
      await savePlaywrightProcedure(connectorName, procedureLog, fieldKeys);
      setProcedureSaved(true);
    } catch (err) {
      logger.error('Failed to save procedure', { error: String(err) });
    } finally {
      setSavingProcedure(false);
    }
  };

  return (
    <div className="flex items-center justify-between pt-1">
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 typo-body text-foreground hover:text-foreground rounded-modal hover:bg-secondary/40 transition-colors"
        >
          Discard
        </button>
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-4 py-2 typo-body text-cyan-400/80 hover:text-cyan-400 rounded-modal border border-cyan-500/15 hover:bg-cyan-500/10 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Re-run Browser
        </button>
      </div>
      <div className="flex items-center gap-2">
        {!healthResult?.success && (
          <span className="typo-body text-foreground">{t.vault.auto_cred_extra.test_to_save}</span>
        )}
        {/* Dev-only: Save procedure for future re-use */}
        {isDev && healthResult?.success && extractedValues.__procedure_log && (
          <button
            onClick={handleSaveProcedure}
            disabled={savingProcedure || procedureSaved}
            className={`flex items-center gap-1.5 px-3 py-2 typo-body rounded-modal border transition-colors ${
              procedureSaved
                ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                : 'border-violet-500/20 text-violet-400/80 hover:bg-violet-500/10 hover:text-violet-400'
            }`}
            title={t.vault.auto_cred_extra.save_procedure_title}
          >
            {savingProcedure ? (
              <LoadingSpinner size="sm" />
            ) : procedureSaved ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Database className="w-3.5 h-3.5" />
            )}
            {procedureSaved ? 'Procedure Saved' : 'Save Procedure'}
          </button>
        )}
        <button
          onClick={onSave}
          disabled={isSaving || !healthResult?.success}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-modal typo-body font-medium transition-all shadow-elevation-3 shadow-emerald-600/20"
        >
          {isSaving ? (
            <LoadingSpinner />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save Credential
        </button>
      </div>
    </div>
  );
}
