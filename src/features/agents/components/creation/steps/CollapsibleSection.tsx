import { useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface CollapsibleSectionProps {
  id: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  defaultOpen?: boolean;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}

export function CollapsibleSection({
  id,
  icon,
  label,
  badge,
  expanded,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const isOpen = expanded.has(id);
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div className="border border-primary/10 rounded-xl bg-secondary/15">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/20 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/65" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/65" />
        )}
        <span className="text-muted-foreground/80">{icon}</span>
        <span className="text-sm font-medium text-foreground/90 flex-1">{label}</span>
        {badge && (
          <span className="text-sm font-medium text-muted-foreground/65 bg-secondary/40 px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={contentRef}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
            onAnimationStart={() => {
              if (contentRef.current) contentRef.current.style.overflow = 'hidden';
            }}
            onAnimationComplete={() => {
              if (contentRef.current && isOpen) contentRef.current.style.overflow = 'visible';
            }}
          >
            <div className="px-3.5 pb-3.5 border-t border-primary/12 pt-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
