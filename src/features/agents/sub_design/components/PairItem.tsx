import { Trash2, ArrowRight, FileInput, FileOutput } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ExamplePair } from '../wizard/ExamplePairCollector';

interface PairItemProps {
  pair: ExamplePair;
  index: number;
  isCollapsed: boolean;
  disabled: boolean;
  onToggleCollapse: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, field: 'input' | 'output', value: string) => void;
}

export function PairItem({ pair, index, isCollapsed, disabled, onToggleCollapse, onRemove, onUpdate }: PairItemProps) {
  const { t, tx } = useTranslation();
  const hasContent = pair.input.trim() || pair.output.trim();
  const preview = hasContent
    ? (pair.input.trim().slice(0, 40) || '(no input)') + ' -> ' + (pair.output.trim().slice(0, 40) || '(no output)')
    : null;

  return (
    <div
      key={pair.id}
      className="animate-fade-slide-in rounded-modal border border-emerald-500/15 bg-emerald-500/[0.02] overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => onToggleCollapse(pair.id)} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
          <span className="typo-label font-semibold text-emerald-400/80 uppercase tracking-wider">{tx(t.agents.design.example_n, { index: index + 1 })}</span>
          {isCollapsed && preview && <span className="typo-caption text-foreground truncate ml-1">{preview}</span>}
        </button>
        <button onClick={() => onRemove(pair.id)} disabled={disabled} className="p-0.5 text-foreground hover:text-red-400 transition-colors" title={t.agents.design.remove_example}>
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {!isCollapsed && (
        <div className="px-3 pb-3 space-y-2">
          <div className="space-y-1">
            <label className="flex items-center gap-1 typo-caption font-medium text-foreground">
              <FileInput className="w-3 h-3" />
              {t.agents.design.input_label}
            </label>
            <textarea
              value={pair.input}
              onChange={(e) => onUpdate(pair.id, 'input', e.target.value)}
              disabled={disabled}
              placeholder={t.agents.design.input_placeholder}
              rows={4}
              className="w-full bg-background/50 border border-emerald-500/10 rounded-card px-3 py-2 typo-code text-foreground font-mono resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/30 transition-all placeholder-muted-foreground/25"
            />
          </div>
          <div className="flex justify-center">
            <ArrowRight className="w-4 h-4 text-emerald-500/40 rotate-90" />
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-1 typo-caption font-medium text-foreground">
              <FileOutput className="w-3 h-3" />
              {t.agents.design.output_label}
            </label>
            <textarea
              value={pair.output}
              onChange={(e) => onUpdate(pair.id, 'output', e.target.value)}
              disabled={disabled}
              placeholder={t.agents.design.output_placeholder}
              rows={4}
              className="w-full bg-background/50 border border-emerald-500/10 rounded-card px-3 py-2 typo-code text-foreground font-mono resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/30 transition-all placeholder-muted-foreground/25"
            />
          </div>
        </div>
      )}
    </div>
  );
}
