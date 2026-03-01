import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, RefreshCw, Eye, EyeOff, Loader2, Save } from 'lucide-react';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';
import type { CredentialTemplateField } from '@/lib/types/types';
import type { ExtractedValues } from './types';
import { buildConnectorContext } from './types';

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
}: AutoCredReviewProps) {
  const ctx = buildConnectorContext(designResult);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${designResult.connector.color}15`, borderColor: `${designResult.connector.color}30` }}
        />
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Review Extracted Credentials
          </h3>
          <p className="text-xs text-muted-foreground/70">
            Values extracted from browser — verify before saving
          </p>
        </div>
      </div>

      {/* Credential name */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground/70">Credential Name</label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-primary/15 bg-secondary/25 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Field values */}
      <div className="space-y-2.5">
        {ctx.fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            value={extractedValues[field.key] ?? ''}
            onChange={(v) => onValueChange(field.key, v)}
          />
        ))}
      </div>

      {/* Healthcheck */}
      <div className="flex items-center gap-3">
        <button
          onClick={onHealthcheck}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-primary/15 hover:bg-secondary/40 text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Test Connection
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
            className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground rounded-lg hover:bg-secondary/40 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-cyan-400/80 hover:text-cyan-400 rounded-lg border border-cyan-500/15 hover:bg-cyan-500/10 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Re-run Browser
          </button>
        </div>
        <button
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-emerald-600/20"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save Credential
        </button>
      </div>
    </motion.div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: CredentialTemplateField;
  value: string;
  onChange: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const isSecret = field.type === 'password';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground/70">
          {field.label}
          {field.required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {isSecret && (
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="p-0.5 text-muted-foreground/50 hover:text-foreground/80 transition-colors"
          >
            {visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
        )}
      </div>
      <input
        type={isSecret && !visible ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder ?? ''}
        className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${
          value
            ? 'border-emerald-500/25 bg-emerald-500/5 text-foreground'
            : 'border-primary/15 bg-secondary/25 text-muted-foreground/50'
        }`}
      />
      {field.helpText && (
        <p className="text-xs text-muted-foreground/50">{field.helpText}</p>
      )}
    </div>
  );
}
