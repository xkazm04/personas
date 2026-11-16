import { useTranslation } from '@/i18n/useTranslation';
import { AlertCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

export function AiSearchStatusBar({
  aiSearchMode,
  aiSearchLoading,
  aiSearchRationale,
  aiSearchActive,
}: {
  aiSearchMode?: boolean;
  aiSearchLoading?: boolean;
  aiSearchRationale?: string;
  aiSearchActive?: boolean;
  aiCliLog?: string[];
  total: number;
}) {
  const { t } = useTranslation();

  if (!aiSearchMode) return null;
  if (!aiSearchLoading && (aiSearchActive || !aiSearchRationale)) return null;

  return (
    <div className="px-4 pb-2">
      <div className={`flex items-center gap-2 px-3 py-2 rounded-modal max-w-2xl mx-auto ${
        aiSearchLoading
          ? 'bg-role-agent/8 border border-role-agent/15'
          : 'bg-status-warning/8 border border-status-warning/15'
      }`}>
        {aiSearchLoading ? (
          <>
            <LoadingSpinner size="sm" className="text-role-agent flex-shrink-0" />
            <span className="typo-body text-role-agent/80">{t.templates.search.ai_searching}</span>
          </>
        ) : (
          <>
            <AlertCircle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
            <span className="typo-body text-status-warning/80 flex-1">{aiSearchRationale}</span>
          </>
        )}
      </div>
    </div>
  );
}
