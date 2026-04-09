import { Lightbulb, Star } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';

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
  if (!pendingTaskId) return null;

  return (
    <div className="rounded-card border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-emerald-400" />
        <h4 className="typo-heading text-primary [text-shadow:_0_0_8px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
          Capture the winning insight
        </h4>
      </div>
      <p className="typo-body text-foreground">
        What made this approach win? This note is saved to Dev Clone's persona memory
        and injected into future runs as a "learned" insight. Leave blank to skip.
      </p>
      <textarea
        value={insightText}
        onChange={(e) => setInsightText(e.target.value)}
        placeholder="e.g. The test-first approach caught an edge case the minimal-diff approach missed..."
        rows={3}
        className="w-full px-3 py-2 rounded-interactive bg-background/60 border border-primary/15 typo-body text-foreground placeholder:text-foreground/40 focus-ring resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="accent"
          accentColor="emerald"
          size="sm"
          icon={<Star className="w-3.5 h-3.5" />}
          onClick={onConfirm}
          loading={loading}
        >
          Confirm winner
        </Button>
      </div>
    </div>
  );
}
