import { Globe, Sparkles, ArrowRight, Link2, MessageSquareText } from 'lucide-react';
import type { AutoCredMode } from '../helpers/types';
import { useTranslation } from '@/i18n/useTranslation';

interface UniversalAutoCredInputPhaseProps {
  serviceUrl: string;
  onServiceUrlChange: (url: string) => void;
  description: string;
  onDescriptionChange: (desc: string) => void;
  isValidUrl: boolean;
  modeChecked: boolean;
  mode: AutoCredMode;
  onStart: () => void;
  onCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function UniversalAutoCredInputPhase({
  serviceUrl,
  onServiceUrlChange,
  description,
  onDescriptionChange,
  isValidUrl,
  modeChecked,
  mode,
  onStart,
  onCancel,
  onKeyDown,
}: UniversalAutoCredInputPhaseProps) {
  const { t } = useTranslation();
  return (
    <div className="animate-fade-slide-in space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4 p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5">
        <div className="w-12 h-12 rounded-xl border border-indigo-500/30 bg-indigo-500/10 flex items-center justify-center shrink-0">
          <Sparkles className="w-6 h-6 text-indigo-400" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Universal Auto-Setup
          </h3>
          <p className="text-sm text-muted-foreground/80 mt-1">
            Connect to <em>any</em> web service. Provide a URL and description, and AI will navigate the site to discover and create API credentials automatically.
          </p>
        </div>
      </div>

      {/* Service URL */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground/90 flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-muted-foreground/60" />
          Service URL
        </label>
        <input
          type="url"
          value={serviceUrl}
          onChange={(e) => onServiceUrlChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="https://app.example.com or https://developer.example.com"
          className="w-full px-3 py-2.5 bg-secondary/30 border border-primary/10 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 transition-colors"
          autoFocus
        />
        {serviceUrl && !isValidUrl && (
          <p className="text-xs text-red-400/80">{t.vault.auto_cred_extra.invalid_url}</p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground/90 flex items-center gap-1.5">
          <MessageSquareText className="w-3.5 h-3.5 text-muted-foreground/60" />
          What do you need?
          <span className="text-muted-foreground/40 font-normal">(optional)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="e.g. I need an API key for their REST API to read and write data. The developer portal has an API Keys section under Settings."
          rows={3}
          className="w-full px-3 py-2.5 bg-secondary/30 border border-primary/10 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 resize-none transition-colors"
        />
      </div>

      {/* Mode badge */}
      {modeChecked && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
          <Globe className="w-3 h-3" />
          {mode === 'playwright'
            ? t.vault.auto_cred_extra.playwright_available
            : t.vault.auto_cred_extra.guided_mode}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground rounded-xl hover:bg-secondary/40 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onStart}
          disabled={!isValidUrl || !modeChecked}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-all shadow-elevation-3 shadow-indigo-600/20"
        >
          <Sparkles className="w-4 h-4" />
          Discover Credentials
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
