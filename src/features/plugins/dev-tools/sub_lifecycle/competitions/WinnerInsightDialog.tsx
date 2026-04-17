import { Lightbulb, Star } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

interface WinnerInsightDialogProps {
  pendingTaskId: string;
  insightText: string;
  setInsightText: (text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

export function WinnerInsightDialog({
  pendingTaskId,
  insightText,
  setInsightText,
  onConfirm,
  onCancel,
  loading,
}: WinnerInsightDialogProps) {
  const { t } = useTranslation();
  if (!pendingTaskId) return null;

  return (
    <div className="rounded-card border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-emerald-400" />
        <h4 className="typo-section-title">
          {t.plugins.dev_tools.capture_winning_insight}
        </h4>
      </div>
      <p className="typo-body text-foreground">
        {t.plugins.dev_tools.capture_insight_desc}
      </p>
      <textarea
        value={insightText}
        onChange={(e) => setInsightText(e.target.value)}
        placeholder={t.plugins.dev_tools.insight_placeholder}
        rows={3}
        className="w-full px-3 py-2 rounded-interactive bg-background/60 border border-primary/15 typo-body text-foreground placeholder:text-foreground focus-ring resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button
          variant="accent"
          accentColor="emerald"
          size="sm"
          icon={<Star className="w-3.5 h-3.5" />}
          onClick={onConfirm}
          loading={loading}
        >
          {t.plugins.dev_tools.confirm_winner}
        </Button>
      </div>
    </div>
  );
}
