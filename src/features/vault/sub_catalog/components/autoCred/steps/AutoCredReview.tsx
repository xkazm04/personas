import { Plug, AlertTriangle } from 'lucide-react';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { ExtractedValues, ExtractionCompleteness } from '../helpers/types';
import { buildConnectorContext } from '../helpers/types';
import { FieldCaptureRow } from '@/features/vault/sub_credentials/components/forms/FieldCaptureRow';
import { ReviewHealthcheck, ReviewActionButtons } from './ReviewActions';

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

  return (
    <div
      className="animate-fade-slide-in space-y-4"
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
            Values extracted from browser -- verify before saving
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
          className="w-full px-3 py-2 rounded-xl border border-primary/15 bg-secondary/25 text-sm text-foreground focus-ring"
        />
      </div>

      {/* Field values */}
      <div className="space-y-2.5">
        {ctx.fields.filter((field) => field.key).map((field) => {
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
      <ReviewHealthcheck onHealthcheck={onHealthcheck} healthResult={healthResult} />

      {/* Actions */}
      <ReviewActionButtons
        onSave={onSave}
        onRetry={onRetry}
        onCancel={onCancel}
        isSaving={isSaving}
        healthResult={healthResult}
        extractedValues={extractedValues}
        connectorName={designResult.connector.name}
      />
    </div>
  );
}
