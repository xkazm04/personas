import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface SetupGuideSectionProps {
  guide: string;
  connectorLabel: string;
}

export function SetupGuideSection({ guide, connectorLabel }: SetupGuideSectionProps) {
  const [open, setOpen] = useState(false);
  const steps = guide.split('\n').filter(Boolean);

  return (
    <div className="border border-primary/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/30 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
        )}
        <span className="text-sm font-medium text-muted-foreground/70">
          How to get {connectorLabel} credentials
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3 space-y-2">
              {steps.map((line, i) => {
                const stripped = line.replace(/^\d+\.\s*/, '');
                return (
                  <div key={i} className="flex gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center text-sm font-bold text-primary/70">
                      {i + 1}
                    </span>
                    <p className="text-sm text-foreground/75 pt-0.5 leading-relaxed">{stripped}</p>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
