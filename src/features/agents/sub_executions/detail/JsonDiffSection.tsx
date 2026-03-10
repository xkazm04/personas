import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { jsonDiff } from './comparisonHelpers';

export function JsonDiffSection({
  label,
  leftData,
  rightData,
}: {
  label: string;
  leftData: string | null;
  rightData: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const diffs = useMemo(() => jsonDiff(leftData, rightData), [leftData, rightData]);

  if (diffs.length === 0 && !leftData && !rightData) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm text-foreground/80 hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {label}
        {diffs.length > 0 ? (
          <span className="text-sm text-amber-400/70">{diffs.length} diff{diffs.length > 1 ? 's' : ''}</span>
        ) : (
          <span className="text-sm text-muted-foreground/60">identical</span>
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 overflow-hidden"
          >
            {diffs.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 py-2">No differences</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {diffs.map((d, i) => (
                  <div key={i} className="grid grid-cols-[auto_1fr_1fr] gap-2 text-sm font-mono items-start">
                    <span className="text-muted-foreground/50 py-1">{d.path}</span>
                    <div className="px-2 py-1 rounded bg-red-500/5 text-red-400/80 break-all">{d.left}</div>
                    <div className="px-2 py-1 rounded bg-emerald-500/5 text-emerald-400/80 break-all">{d.right}</div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
