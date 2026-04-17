import { X, File, ArrowUpRight } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import type { ContextItem } from './contextMapTypes';
import { useTranslation } from '@/i18n/useTranslation';

export default function ContextDetail({ ctx, onClose }: { ctx: ContextItem; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="animate-fade-slide-in w-80 flex-shrink-0 border-l border-primary/10 pl-5 overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="typo-section-title">{ctx.name}</h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <p className="text-md text-foreground mb-4">{ctx.description}</p>

      <div className="mb-4">
        <h4 className="text-[10px] uppercase tracking-wider text-primary font-medium mb-2">
          Files ({ctx.filePaths.length})
        </h4>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {ctx.filePaths.map((fp) => (
            <div key={fp} className="flex items-center gap-1.5 text-xs text-foreground py-0.5">
              <File className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{fp}</span>
            </div>
          ))}
        </div>
      </div>

      {ctx.keywords.length > 0 && (
        <div className="mb-4">
          <h4 className="text-[10px] uppercase tracking-wider text-primary font-medium mb-2">{t.plugins.dev_tools.keywords}</h4>
          <div className="flex flex-wrap gap-1.5">
            {ctx.keywords.map((kw) => (
              <span key={kw} className="px-2 py-0.5 text-[10px] bg-primary/5 border border-primary/10 rounded-full text-foreground">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {ctx.entryPoints.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-primary font-medium mb-2">{t.plugins.dev_tools.entry_points}</h4>
          <div className="space-y-1">
            {ctx.entryPoints.map((ep) => (
              <div key={ep} className="flex items-center gap-1.5 text-xs text-foreground py-0.5">
                <ArrowUpRight className="w-3 h-3 flex-shrink-0 text-amber-400/60" />
                <span className="truncate">{ep}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
