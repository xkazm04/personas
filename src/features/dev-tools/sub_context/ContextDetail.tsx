import { motion } from 'framer-motion';
import { X, File, ArrowUpRight } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import type { ContextItem } from './contextMapTypes';

export default function ContextDetail({ ctx, onClose }: { ctx: ContextItem; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      className="w-80 flex-shrink-0 border-l border-primary/10 pl-5 overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground/80">{ctx.name}</h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground/70 mb-4">{ctx.description}</p>

      <div className="mb-4">
        <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
          Files ({ctx.filePaths.length})
        </h4>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {ctx.filePaths.map((fp) => (
            <div key={fp} className="flex items-center gap-1.5 text-xs text-muted-foreground/60 py-0.5">
              <File className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{fp}</span>
            </div>
          ))}
        </div>
      </div>

      {ctx.keywords.length > 0 && (
        <div className="mb-4">
          <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">Keywords</h4>
          <div className="flex flex-wrap gap-1.5">
            {ctx.keywords.map((kw) => (
              <span key={kw} className="px-2 py-0.5 text-[10px] bg-primary/5 border border-primary/10 rounded-full text-muted-foreground/60">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {ctx.entryPoints.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">Entry Points</h4>
          <div className="space-y-1">
            {ctx.entryPoints.map((ep) => (
              <div key={ep} className="flex items-center gap-1.5 text-xs text-muted-foreground/60 py-0.5">
                <ArrowUpRight className="w-3 h-3 flex-shrink-0 text-amber-400/60" />
                <span className="truncate">{ep}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
