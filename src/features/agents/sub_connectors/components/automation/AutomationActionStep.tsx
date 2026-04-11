import { Clock, Check, Circle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { STAGE_DEFS } from '../../libs/useAutomationSetup';
import type { RefObject } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

interface AutomationActionStepProps {
  elapsed: number;
  stageIndex: number;
  tailLines: string[];
  outputLinesLength: number;
  tailRef: RefObject<HTMLDivElement>;
  onCancel: () => void;
}

export function AutomationActionStep({
  elapsed, stageIndex, tailLines, outputLinesLength, tailRef, onCancel,
}: AutomationActionStepProps) {
  const { t } = useTranslation();
  return (
    <div key="analyzing" className="animate-fade-slide-in space-y-4">
      <div className="flex items-center justify-between px-1">
        {elapsed >= 3 ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{t.agents.connectors.auto_elapsed.replace('{elapsed}', String(elapsed))}</span>
          </div>
        ) : <div />}
        <span className="text-sm text-muted-foreground">{t.agents.connectors.auto_typically}</span>
      </div>

      <div className="h-2 rounded-full bg-primary/10 overflow-hidden">
        <div
          className="animate-fade-in h-full rounded-full bg-primary" style={{ width: `${Math.min((stageIndex / STAGE_DEFS.length) * 100, 100)}%` }}
        />
      </div>

      <div className="space-y-1 px-1">
        {STAGE_DEFS.map((def, i) => {
          const status = i < stageIndex ? 'completed' : i === stageIndex ? 'active' : 'pending';
          return (
            <div key={i} className="animate-fade-slide-in flex items-center gap-3 py-1.5">
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                {status === 'completed' ? (
                  <div className="w-5 h-5 rounded-full bg-brand-emerald/15 flex items-center justify-center">
                    <Check className="w-3 h-3 text-brand-emerald" />
                  </div>
                ) : status === 'active' ? (
                  <LoadingSpinner className="text-primary" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-muted-foreground/20" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium ${status === 'completed' ? 'text-muted-foreground' : status === 'active' ? 'text-foreground' : 'text-muted-foreground/60'}`}>
                  {def.label}
                </span>
                {status === 'active' && <span className="ml-2 text-sm text-muted-foreground">{def.description}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {tailLines.length > 0 && (
        <div ref={tailRef} className="px-3 py-2 rounded-xl bg-secondary/30 border border-border/60 text-sm text-muted-foreground font-mono max-h-[4.5rem] overflow-y-auto">
          {tailLines.map((line, i) => (
            <div key={outputLinesLength - tailLines.length + i}>{line}</div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onCancel} className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-xl text-sm transition-colors">
          {t.common.cancel}
        </button>
      </div>
    </div>
  );
}
