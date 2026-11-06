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
    <div className="border border-status-warning/20 rounded-card bg-status-warning/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-status-warning/15">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 typo-label rounded-interactive border ${modeBadge.bg} ${modeBadge.text}`}>
            {modeBadge.label}
          </span>
          <span className="typo-body text-status-warning">{t.shared.use_cases_extra.example_output}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-interactive hover:bg-surface-2 text-ink-1 hover:text-ink-1 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Mock output */}
      <div className="p-3">
        <pre className="typo-code text-ink-1 bg-background/40 rounded-card p-3 overflow-auto max-h-64 border border-status-warning/10">
          {useCase.sample_input
            ? JSON.stringify(useCase.sample_input, null, 2)
            : '// No sample data provided'}
        </pre>
      </div>
    </div>
  );
}
