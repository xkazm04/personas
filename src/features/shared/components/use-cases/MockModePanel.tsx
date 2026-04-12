import { X } from 'lucide-react';
import type { UseCaseItem } from './UseCasesList';
import { useTranslation } from '@/i18n/useTranslation';

interface MockModePanelProps {
  useCase: UseCaseItem;
  modeBadge: { label: string; bg: string; text: string };
  onClose: () => void;
}

export function MockModePanel({ useCase, modeBadge, onClose }: MockModePanelProps) {
  const { t } = useTranslation();
  return (
    <div className="border border-amber-500/20 rounded-xl bg-amber-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-amber-500/15">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 typo-label rounded border ${modeBadge.bg} ${modeBadge.text}`}>
            {modeBadge.label}
          </span>
          <span className="typo-body text-amber-400/70">{t.shared.use_cases_extra.example_output}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-secondary/60 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Mock output */}
      <div className="p-3">
        <pre className="typo-code text-foreground/70 bg-background/40 rounded-lg p-3 overflow-auto max-h-64 border border-amber-500/10">
          {useCase.sample_input
            ? JSON.stringify(useCase.sample_input, null, 2)
            : '// No sample data provided'}
        </pre>
      </div>
    </div>
  );
}
