import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, RefreshCw, Loader2, Save, Database, Plug, AlertTriangle } from 'lucide-react';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { ExtractedValues, ExtractionCompleteness } from '../helpers/types';
import { buildConnectorContext } from '../helpers/types';
import { savePlaywrightProcedure } from '@/api/vault/autoCredBrowser';
import { FieldCaptureRow } from '@/features/vault/sub_forms/FieldCaptureRow';

interface AutoCredReviewProps {
  designResult: CredentialDesignResult;
  credentialName: string;
  onCredentialNameChange: (name: string) => void;
  extractedValues: ExtractedValues;
  onValueChange: (key: string, value: string) => void;
  onHealthcheck: () => void;
  healthResult: { success: boolean; message: string } | null;
  onSave: () => void;
  onRetry: () => void;
  onCancel: () => void;
  isSaving: boolean;
  isPartial?: boolean;
  completeness?: ExtractionCompleteness | null;
}

export function AutoCredReview({
  designResult,
  credentialName,
  onCredentialNameChange,
  extractedValues,
  onValueChange,
  onHealthcheck,
  healthResult,
  onSave,
  onRetry,
  onCancel,
  isSaving,
  isPartial = false,
  completeness,
}: AutoCredReviewProps) {
  const ctx = buildConnectorContext(designResult);
  const isDev = import.meta.env.DEV;
  const [savingProcedure, setSavingProcedure] = useState(false);
  const [procedureSaved, setProcedureSaved] = useState(false);
  const [isHealthchecking, setIsHealthchecking] = useState(false);

  const handleSaveProcedure = async () => {
    const procedureLog = extractedValues.__procedure_log ?? '';
    if (!procedureLog) return;
    setSavingProcedure(true);
    try {
      const fieldKeys = JSON.stringify(ctx.fields.map((f) => f.key));
      await savePlaywrightProcedure(
        designResult.connector.name,
        procedureLog,
        fieldKeys,
      );
      setProcedureSaved(true);
    } catch (err) {
      console.error('Failed to save procedure:', err);
    } finally {
      setSavingProcedure(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${designResult.connector.color}15`, borderColor: `${designResult.connector.color}30` }}
        >
          <Plug className="w-5 h-5" style={{ color: designResult.connector.color }} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Review Extracted Credentials
          </h3>
          <p className="text-sm text-muted-foreground/70">
            Values extracted from browser — verify before saving
          </p>
        </div>
      </div>

      {/* Partial extraction warning */}
      {(isPartial || completeness?.isPartial) && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">Partial Extraction</p>
            <p className="text-sm text-muted-foreground/70 mt-0.5">
              {completeness
                ? `${completeness.filledRequired} of ${completeness.totalRequired} required fields filled. Complete the missing fields before saving.`
                : 'Some fields could not be filled automatically. Please complete the missing fields manually before saving.'}
            </p>
          </div>
        </div>
      )}

      {/* Credential name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-muted-foreground/70">Credential Name</label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-primary/15 bg-secondary/25 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Field values */}
      <div className="space-y-2.5">
        {ctx.fields.map((field) => {
          const isEmpty = !(extractedValues[field.key] ?? '').trim();
          const isMissing = (completeness?.missingKeys.includes(field.key)) ?? (isPartial && isEmpty && field.required);
          return (
            <div key={field.key} className={isMissing ? 'ring-1 ring-amber-500/30 rounded-lg' : ''}>
              <FieldCaptureRow
                source="auto"
                mode="confirming"
                label={isMissing ? `${field.label} (missing)` : field.label}
                value={extractedValues[field.key] ?? ''}
                onChange={(nextValue) => onValueChange(field.key, nextValue)}
                placeholder={field.placeholder ?? ''}
                required={field.required}
                helpText={field.helpText}
                inputType={field.type === 'password' ? 'password' : 'text'}
                allowCopy
              />
            </div>
          );
        })}
      </div>

      {/* Healthcheck */}
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
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border border-primary/15 hover:bg-secondary/40 text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          {isHealthchecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {isHealthchecking ? 'Testing...' : 'Test Connection'}
        </button>
        {healthResult && (
          <div className={`flex items-center gap-1.5 text-sm ${healthResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
            {healthResult.success ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <XCircle className="w-3.5 h-3.5" />
            )}
            {healthResult.message}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground rounded-xl hover:bg-secondary/40 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-cyan-400/80 hover:text-cyan-400 rounded-xl border border-cyan-500/15 hover:bg-cyan-500/10 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Re-run Browser
          </button>
        </div>
        <div className="flex items-center gap-2">
          {!healthResult?.success && (
            <span className="text-sm text-muted-foreground/60">Test connection to enable save</span>
          )}
          {/* Dev-only: Save procedure for future re-use */}
          {isDev && healthResult?.success && extractedValues.__procedure_log && (
            <button
              onClick={handleSaveProcedure}
              disabled={savingProcedure || procedureSaved}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border transition-colors ${
                procedureSaved
                  ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                  : 'border-violet-500/20 text-violet-400/80 hover:bg-violet-500/10 hover:text-violet-400'
              }`}
              title="Save browser procedure for this connector (dev)"
            >
              {savingProcedure ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-emerald-600/20"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Credential
          </button>
        </div>
      </div>
    </motion.div>
  );
}
