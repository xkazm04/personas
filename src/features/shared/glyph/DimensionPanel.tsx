import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { GlyphRow, GlyphDimension } from './types';
import { DIM_META } from './dimMeta';
import { DimContent } from './dimContent';

interface DimensionPanelProps {
  dim: GlyphDimension;
  row: GlyphRow;
  onClose: () => void;
}

/** Overlay panel shown when a petal is clicked — reads like a single matrix
 *  cell: dim-colored accent bar on top, icon + label, then the dim's body.
 *  Back arrow returns the user to the sigil. Scale/translate entry animation
 *  is driven by the parent's AnimatePresence. */
export function DimensionPanel({ dim, row, onClose }: DimensionPanelProps) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const meta = DIM_META[dim];
  const Icon = meta.icon;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: 6 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="absolute inset-x-6 top-16 bottom-24 z-20 rounded-modal bg-card-bg/95 backdrop-blur-md border border-card-border shadow-elevation-3 flex flex-col overflow-hidden"
      style={{ boxShadow: `0 0 24px ${meta.color}22, 0 4px 16px rgba(0,0,0,0.25)` }}
    >
      <div
        className="absolute top-0 left-0 w-full h-1"
        style={{ background: `linear-gradient(90deg, ${meta.color}, transparent)` }}
      />
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-full bg-primary/10 hover:bg-primary/20 border border-card-border flex items-center justify-center text-foreground/75 hover:text-foreground cursor-pointer transition-colors"
          title="Back to leaves"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <span
          className="w-7 h-7 rounded-md flex items-center justify-center"
          style={{ background: `${meta.color}33`, boxShadow: `0 0 8px ${meta.color}55` }}
        >
          <Icon className="w-4 h-4" style={{ color: '#fff' }} />
        </span>
        <span className="typo-label font-bold uppercase tracking-[0.18em] text-foreground">
          {c[meta.labelKey]}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin">
        <DimContent dim={dim} row={row} t={t} />
      </div>
    </motion.div>
  );
}
