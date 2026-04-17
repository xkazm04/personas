/**
 * ModeTabBar -- tab bar for selecting run mode in DesignReviewRunner.
 */
import { Beaker, FileText, List } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

type RunMode = 'predefined' | 'custom' | 'batch';

interface ModeTabBarProps {
  mode: RunMode;
  onModeChange: (m: RunMode) => void;
  batchCount: number;
}

export function ModeTabBar({ mode, onModeChange, batchCount }: ModeTabBarProps) {
  const { t } = useTranslation();
  const tabs: { id: RunMode; label: string; Icon: typeof Beaker }[] = [
    { id: 'predefined', label: t.templates.generation.mode_predefined, Icon: Beaker },
    { id: 'custom', label: t.templates.generation.mode_custom, Icon: FileText },
    { id: 'batch', label: batchCount > 0 ? t.templates.generation.mode_batch_count.replace('{count}', String(batchCount)) : t.templates.generation.mode_batch, Icon: List },
  ];

  return (
    <div className="flex gap-2">
      {tabs.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onModeChange(id)}
          className={`px-4 py-2 typo-body rounded-modal border transition-all flex items-center gap-2 ${
            mode === id
              ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
              : 'bg-secondary/30 border-primary/10 text-foreground hover:border-primary/20'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
