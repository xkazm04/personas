import { useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Save, Database } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { savePlaywrightProcedure } from '@/api/vault/autoCredBrowser';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import Button from '@/features/shared/components/buttons/Button';

interface ReviewHealthcheckProps {
  onHealthcheck: () => void;
  healthResult: { success: boolean; message: string } | null;
}

export function ReviewHealthcheck({ onHealthcheck, healthResult }: ReviewHealthcheckProps) {
  const { t } = useTranslation();
  const [isHealthchecking, setIsHealthchecking] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        onClick={async () => {
          setIsHealthchecking(true);
          try {
            await Promise.resolve(onHealthcheck());
          } finally {
            setIsHealthchecking(false);
          }
        }}
        disabled={isHealthchecking}
        variant="secondary"
        size="sm"
        icon={isHealthchecking ? <LoadingSpinner size="sm" /> : <RefreshCw className="w-3.5 h-3.5" />}
      >
        {isHealthchecking ? t.vault.auto_cred.testing : t.vault.auto_cred.test_connection}
      </Button>
      {healthResult && (
        <div className={`flex items-center gap-1.5 typo-body ${healthResult.success ? 'text-status-success' : 'text-status-error'}`}>
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
      // Silent until 2026-09-17: a failed save left the button looking idle,
      // so the operator re-ran a ten-minute browser session next time and
      // never learned why. `save_playwright_procedure` rejects with the
      // structured AppError envelope, which toastCatch already unwraps.
      toastCatch('ReviewActionButtons:savePlaywrightProcedure')(err);
    } finally {
      setSavingProcedure(false);
    }
  };

  return (
    <div className="flex items-center justify-between pt-1">
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={onCancel}
          variant="ghost"
          size="md"
        >
          {t.vault.auto_cred.discard}
        </Button>
        <Button
          type="button"
          onClick={onRetry}
          variant="accent"
          tone="highlight"
          size="md"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          {t.vault.auto_cred.re_run_browser}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        {!healthResult?.success && (
          <span className="typo-body text-foreground">{t.vault.auto_cred_extra.test_to_save}</span>
        )}
        {/* Save the click path so the NEXT connect replays it instead of
            paying for another Chromium session. `TauriPlaywrightAdapter`
            already looks the procedure up and sends it as `saved_procedure`,
            so the replay path was fully built -- and unreachable, because this
            button was `import.meta.env.DEV` only and nothing in a production
            build ever wrote a row for it to find. */}
        {healthResult?.success && extractedValues.__procedure_log && (
          <Button
            type="button"
            onClick={handleSaveProcedure}
            disabled={savingProcedure || procedureSaved}
            variant="accent"
            tone="agent"
            size="md"
            tooltip={t.vault.auto_cred_extra.save_procedure_title}
            icon={savingProcedure ? (
              <LoadingSpinner size="sm" />
            ) : procedureSaved ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Database className="w-3.5 h-3.5" />
            )}
          >
            {procedureSaved ? t.vault.auto_cred.procedure_saved : t.vault.auto_cred.save_procedure}
          </Button>
        )}
        <Button
          type="button"
          onClick={onSave}
          disabled={isSaving || !healthResult?.success}
          variant="accent"
          tone="success"
          size="md"
          icon={isSaving ? (
            <LoadingSpinner />
          ) : (
            <Save className="w-4 h-4" />
          )}
        >
          {t.vault.auto_cred.save_credential}
        </Button>
      </div>
    </div>
  );
}
