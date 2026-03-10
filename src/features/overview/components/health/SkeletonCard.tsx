import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

export function SkeletonCard({
  stub,
  stubIdx,
  SectionIcon,
  sectionStyle,
  shouldAnimate,
  duration,
}: {
  stub: { id: string; label: string };
  stubIdx: number;
  SectionIcon: React.ElementType;
  sectionStyle: { badge: string; icon: string };
  shouldAnimate: boolean;
  duration: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0.5, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: shouldAnimate ? stubIdx * 0.08 : 0, duration: shouldAnimate ? 0.3 : duration }}
      className="rounded-xl border border-primary/10 bg-secondary/20 shadow-sm overflow-hidden flex flex-col min-h-[160px]"
    >
      <div className="flex items-center gap-3 px-4 py-4 border-b border-primary/5 bg-background/30">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${sectionStyle.badge}`}>
          <SectionIcon className={`w-4 h-4 ${sectionStyle.icon}`} />
        </div>
        <span className="text-sm font-bold text-foreground/90 uppercase tracking-widest">
          {stub.label}
        </span>
        <div className="ml-auto">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground/50" />
        </div>
      </div>
      <div className="px-4 py-4 space-y-4 flex-1 relative overflow-hidden">
        <motion.div
          className="absolute inset-y-0 -left-1/2 w-[200%] bg-gradient-to-r from-transparent via-primary/5 to-transparent"
          animate={shouldAnimate ? { x: ['0%', '200%'] } : { opacity: 0 }}
          transition={
            shouldAnimate
              ? { duration: 2, repeat: Infinity, ease: 'linear', delay: stubIdx * 0.15 }
              : { duration: 0 }
          }
        />
        <div className="flex gap-3">
          <div className="w-4 h-4 rounded-full bg-primary/10 flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="h-3 w-3/4 rounded-lg bg-primary/10" />
            <div className="h-2 w-1/2 rounded-lg bg-primary/5" />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="w-4 h-4 rounded-full bg-primary/10 flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="h-3 w-4/5 rounded-lg bg-primary/10" />
            <div className="h-2 w-2/3 rounded-lg bg-primary/5" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
