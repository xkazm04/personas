import { useState } from 'react';
import { Sparkles, Image as ImageIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { EmptyStateContent, EmptyStateMotif, EmptyStateVariant } from './types';
import { MotionEmptyState } from './MotionEmptyState';
import { IllustrationEmptyState } from './IllustrationEmptyState';

/**
 * /prototype scaffold (2026-05-24) — A/B host for an Overview empty state.
 *
 * Tab-switches between the two directional variants without forking call sites:
 * every Overview empty state renders <EmptyStateVariantHost motif=... content=...>.
 * The tab strip + this wrapper are throwaway; at consolidation the winning
 * variant per module is inlined and this host is removed.
 *
 * NOTE: tab labels are intentionally hardcoded English — this is a dev-only
 * comparison affordance that does not ship, so it is exempt from i18n.
 */

const TABS: { id: EmptyStateVariant; label: string; sub: string; icon: typeof Sparkles }[] = [
  { id: 'motion', label: 'Motion', sub: 'Animated SVG', icon: Sparkles },
  { id: 'illustration', label: 'Illustration', sub: 'Leonardo hero', icon: ImageIcon },
];

export function EmptyStateVariantHost({
  motif,
  content,
  className,
}: {
  motif: EmptyStateMotif;
  content: EmptyStateContent;
  className?: string;
}) {
  const [variant, setVariant] = useState<EmptyStateVariant>('motion');

  return (
    <div className={`flex flex-col items-center gap-2 ${className ?? ''}`}>
      {/* throwaway prototype tab strip */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-secondary/40 border border-primary/10">
        {TABS.map((tab) => {
          const active = tab.id === variant;
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setVariant(tab.id)}
              className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption transition-colors focus-ring ${
                active ? 'text-foreground' : 'text-foreground/55 hover:text-foreground/80'
              }`}
            >
              {active && (
                <motion.div
                  layoutId={`empty-variant-tab-${motif}`}
                  className="absolute inset-0 rounded-lg bg-primary/15 border border-primary/25"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <TabIcon className="relative w-3.5 h-3.5" />
              <span className="relative font-medium">{tab.label}</span>
              <span className="relative text-foreground/40">· {tab.sub}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={variant}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="w-full flex justify-center"
        >
          {variant === 'motion' ? (
            <MotionEmptyState motif={motif} content={content} />
          ) : (
            <IllustrationEmptyState motif={motif} content={content} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
