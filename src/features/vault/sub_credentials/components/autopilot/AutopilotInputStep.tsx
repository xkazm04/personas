import { Loader2, Globe, FileText, Zap } from 'lucide-react';
import { useFieldValidation } from '@/features/shared/components/forms/useFieldValidation';
import { SuccessCheck } from '@/features/shared/components/forms/SuccessCheck';
import { useTranslation } from '@/i18n/useTranslation';

interface AutopilotInputStepProps {
  inputMode: 'url' | 'paste';
  setInputMode: (mode: 'url' | 'paste') => void;
  specUrl: string;
  setSpecUrl: (url: string) => void;
  specContent: string;
  setSpecContent: (content: string) => void;
  isParsing: boolean;
  onParse: () => void;
  urlValidation: ReturnType<typeof useFieldValidation>;
}

export function AutopilotInputStep({
  inputMode,
  setInputMode,
  specUrl,
  setSpecUrl,
  specContent,
  setSpecContent,
  isParsing,
  onParse,
  urlValidation,
}: AutopilotInputStepProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setInputMode('url')}
          className={`flex items-center gap-2 px-3 py-2 rounded-card border text-sm transition-all ${
            inputMode === 'url'
              ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
              : 'bg-secondary/25 border-primary/15 text-muted-foreground hover:bg-secondary/40'
          }`}
        >
          <Globe className="w-4 h-4" />
          From URL
        </button>
        <button
          onClick={() => setInputMode('paste')}
          className={`flex items-center gap-2 px-3 py-2 rounded-card border text-sm transition-all ${
            inputMode === 'paste'
              ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
              : 'bg-secondary/25 border-primary/15 text-muted-foreground hover:bg-secondary/40'
          }`}
        >
          <FileText className="w-4 h-4" />
          Paste Content
        </button>
      </div>

      {inputMode === 'url' ? (
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground/80">
            OpenAPI Spec URL
            {urlValidation.validationState === 'validating' && (
              <Loader2 aria-hidden="true" className="ml-1.5 inline-block w-3.5 h-3.5 animate-spin text-muted-foreground/60 align-text-bottom" />
            )}
            {urlValidation.validationState === 'valid' && (
              <span className="ml-1.5"><SuccessCheck visible /></span>
            )}
          </label>
          <input
            type="url"
            value={specUrl}
            onChange={(e) => {
              setSpecUrl(e.target.value);
              urlValidation.onChange(e.target.value);
            }}
            placeholder="https://api.example.com/openapi.json"
            data-testid="vault-autopilot-url-input"
            className={`w-full px-3 py-2.5 bg-secondary/30 border rounded-card text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-blue-500/40 ${
              urlValidation.validationState === 'error' ? 'border-red-500/40' :
              urlValidation.validationState === 'valid' ? 'border-emerald-500/30' :
              'border-primary/15'
            }`}
          />
          {urlValidation.error ? (
            <p className="animate-fade-slide-in text-xs text-red-400" role="alert">{urlValidation.error}</p>
          ) : (
            <p className="text-xs text-muted-foreground/40">
              Supports OpenAPI 3.x and Swagger 2.x specs in JSON or YAML format
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground/80">{t.vault.autopilot.paste_spec}</label>
          <textarea
            value={specContent}
            onChange={(e) => setSpecContent(e.target.value)}
            placeholder={'{\n  "openapi": "3.0.0",\n  "info": { "title": "My API", ... },\n  "paths": { ... }\n}'}
            rows={12}
            className="w-full px-3 py-2.5 bg-secondary/30 border border-primary/15 rounded-card text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-blue-500/40 font-mono resize-y"
          />
        </div>
      )}

      <button
        onClick={onParse}
        disabled={isParsing || (inputMode === 'url' ? !specUrl.trim() : !specContent.trim())}
        data-testid="vault-autopilot-submit"
        className="flex items-center gap-2 px-4 py-2.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-400 rounded-card text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        {isParsing ? 'Parsing Spec...' : 'Parse & Analyze'}
      </button>
    </div>
  );
}
