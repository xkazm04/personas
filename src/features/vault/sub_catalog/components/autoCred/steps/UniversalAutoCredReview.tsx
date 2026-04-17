import { CheckCircle2, XCircle, RefreshCw, Save, AlertTriangle, Sparkles } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { ExtractedValues, DiscoveredField, DiscoveredConnector } from '../helpers/types';
import { UniversalFieldRow } from './ReviewTable';
import { useTranslation } from '@/i18n/useTranslation';

interface UniversalAutoCredReviewProps {
  designResult: CredentialDesignResult;
  credentialName: string;
  onCredentialNameChange: (name: string) => void;
  extractedValues: ExtractedValues;
  onValueChange: (key: string, value: string) => void;
  onSave: () => void;
  onRetry: () => void;
  onCancel: () => void;
  isSaving: boolean;
  isPartial?: boolean;
  discoveredFields: DiscoveredField[] | null;
  discoveredConnector: DiscoveredConnector | null;
}

export function UniversalAutoCredReview({
  credentialName,
  onCredentialNameChange,
  extractedValues,
  onValueChange,
  onSave,
  onRetry,
  onCancel,
  isSaving,
  isPartial = false,
  discoveredFields,
  discoveredConnector,
}: UniversalAutoCredReviewProps) {
  const { t } = useTranslation();
  // Derive fields from discovered_fields or from extracted_values keys
  const fields: DiscoveredField[] = (discoveredFields ?? Object.keys(extractedValues)
    .filter((k) => !k.startsWith('__'))
    .map((key) => ({
      key,
      label: key
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      type: key.toLowerCase().includes('secret') || key.toLowerCase().includes('key') || key.toLowerCase().includes('token') || key.toLowerCase().includes('password')
        ? 'password'
        : 'text',
      required: true,
    }))).filter((f) => f.key);

  const filledCount = fields.filter((f) => (extractedValues[f.key] ?? '').trim()).length;
  const allFilled = filledCount === fields.length;
  const connectorLabel = discoveredConnector?.label ?? 'Service';

  return (
    <div className="animate-fade-slide-in space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 rounded-modal border border-indigo-500/20 bg-indigo-500/5">
        <div
          className="w-10 h-10 rounded-modal border flex items-center justify-center"
          style={{
            backgroundColor: `${discoveredConnector?.color ?? '#6366f1'}15`,
            borderColor: `${discoveredConnector?.color ?? '#6366f1'}30`,
          }}
        >
          <Sparkles className="w-5 h-5" style={{ color: discoveredConnector?.color ?? '#6366f1' }} />
        </div>
        <div className="flex-1">
          <h4 className="typo-heading font-semibold text-foreground">
            Discovered: {connectorLabel}
          </h4>
          <p className="typo-caption text-foreground">
            {fields.length} field{fields.length !== 1 ? 's' : ''} discovered
            {discoveredConnector?.category ? ` \u00b7 ${discoveredConnector.category}` : ''}
          </p>
        </div>
        {isPartial && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-card bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span className="typo-caption font-medium text-amber-400">{t.vault.auto_cred_extra.partial_badge}</span>
          </div>
        )}
      </div>

      {/* Credential name */}
      <div className="space-y-1.5">
        <label className="typo-label font-medium text-foreground uppercase tracking-wider">
          Credential Name
        </label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          className="w-full px-3 py-2 bg-secondary/30 border border-primary/10 rounded-card typo-body text-foreground focus:outline-none focus:border-indigo-500/40 transition-colors"
        />
      </div>

      {/* Extracted fields */}
      <div className="space-y-1.5">
        <label className="typo-label font-medium text-foreground uppercase tracking-wider">
          Extracted Values
        </label>
        <div className="space-y-2">
          {fields.map((field) => (
            <UniversalFieldRow
              key={field.key}
              field={field}
              value={extractedValues[field.key] ?? ''}
              onChange={(val) => onValueChange(field.key, val)}
            />
          ))}
        </div>
        {fields.length === 0 && (
          <div className="typo-body text-foreground text-center py-4">
            No fields were discovered. Try again with a more specific description.
          </div>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        {allFilled ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="typo-body text-emerald-400">All {fields.length} fields captured</span>
          </>
        ) : (
          <>
            <XCircle className="w-4 h-4 text-amber-400" />
            <span className="typo-body text-amber-400">{filledCount}/{fields.length} fields captured</span>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-2 typo-body text-foreground hover:text-foreground border border-primary/10 rounded-modal hover:bg-secondary/40 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-2 typo-body text-foreground hover:text-muted-foreground rounded-modal hover:bg-secondary/30 transition-colors"
          >
            Cancel
          </button>
        </div>
        <button
          onClick={onSave}
          disabled={isSaving || fields.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-modal typo-body font-medium transition-all shadow-elevation-3 shadow-emerald-600/20"
        >
          {isSaving ? (
            <LoadingSpinner className="text-white" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save Credential
        </button>
      </div>
    </div>
  );
}
