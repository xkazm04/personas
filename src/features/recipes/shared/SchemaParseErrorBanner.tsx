import { AlertTriangle } from 'lucide-react';
import { useRecipeSharedTranslation } from './i18n/useRecipeSharedTranslation';

interface SchemaParseErrorBannerProps {
  parseError: string;
}

export function SchemaParseErrorBanner({ parseError }: SchemaParseErrorBannerProps) {
  const { t } = useRecipeSharedTranslation();

  return (
    <div className="rounded-card border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="typo-body text-foreground">{t.schemaParseError}</p>
          <p className="typo-caption text-foreground font-mono mt-1">
            {t.schemaParseErrorDetail.replace('{error}', parseError)}
          </p>
          <p className="typo-caption text-foreground mt-1">{t.schemaParseErrorHint}</p>
        </div>
      </div>
    </div>
  );
}
