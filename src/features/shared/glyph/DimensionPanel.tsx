import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Send } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { GlyphRow, GlyphDimension } from './types';
import { DIM_META } from './dimMeta';
import { DimContent } from './dimContent';
import { DebtText, debtText } from '@/i18n/DebtText';


interface DimensionPanelProps {
  dim: GlyphDimension;
  row: GlyphRow;
  onClose: () => void;
  /** When provided, renders a "refine this dimension" panel that lets the user
   *  send a freeform change request for this dim. The caller is expected to
   *  prefix the feedback with dim + use-case context before sending to the
   *  build engine. */
  onRefine?: (feedback: string) => void;
  /** When true, the refine textarea + button are hidden — the build is
   *  already running and dimension state is locked. */
  isBuilding?: boolean;
}

/** Overlay panel shown when a petal is clicked — reads like a single matrix
 *  cell: dim-colored accent bar on top, icon + label, then the dim's body.
 *  Back arrow returns the user to the sigil. Scale/translate entry animation
 *  is driven by the parent's AnimatePresence. */
export function DimensionPanel({ dim, row, onClose, onRefine, isBuilding }: DimensionPanelProps) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const motion_ = useMotion();
  const meta = DIM_META[dim];
  const Icon = meta.icon;
  const [refineText, setRefineText] = useState('');
  const canRefine = !!onRefine && !isBuilding;

  const submitRefine = () => {
    if (!canRefine || !refineText.trim()) return;
    onRefine!(refineText.trim());
    setRefineText('');
    onClose();
  };

  return (
    <motion.div
      initial={motion_.shouldAnimate ? { opacity: 0, scale: 0.92, y: 8 } : { opacity: 1, scale: 1, y: 0 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={motion_.shouldAnimate ? { opacity: 0, scale: 0.94, y: 6 } : { opacity: 0 }}
      transition={motion_.shouldAnimate ? { duration: 0.22, ease: 'easeOut' } : { duration: 0 }}
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
          className="w-7 h-7 rounded-full bg-primary/10 hover:bg-primary/20 border border-card-border flex items-center justify-center text-foreground hover:text-foreground cursor-pointer transition-colors"
          title={debtText("auto_back_to_leaves_84907682")}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <span
          className="w-7 h-7 rounded-input flex items-center justify-center"
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
      {canRefine && (
        <div
          className="flex flex-col gap-2 px-4 py-3 border-t border-card-border"
          style={{ background: `linear-gradient(180deg, transparent, ${meta.color}0a)` }}
        >
          <label className="typo-label font-semibold uppercase tracking-[0.18em] text-foreground">
            <DebtText k="auto_refine_this_dimension_4c22b730" />
          </label>
          <textarea
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submitRefine();
              }
            }}
            rows={2}
            placeholder={debtText("auto_describe_the_change_e_g_switch_review_to_o_6839e49f")}
            className="w-full px-3 py-2 rounded-input border border-card-border bg-card-bg typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40 resize-none"
          />
          <button
            type="button"
            disabled={!refineText.trim()}
            onClick={submitRefine}
            className="self-end inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-primary/15 border border-primary/30 hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed typo-label font-semibold text-foreground cursor-pointer transition-colors"
          >
            <Send className="w-3.5 h-3.5" /> <DebtText k="auto_apply_on_rebuild_9a3f781c" />
          </button>
        </div>
      )}
      {!!isBuilding && (
        <div className="px-4 py-3 border-t border-card-border bg-foreground/[0.03]">
          <span className="typo-label text-foreground italic">
            <DebtText k="auto_build_in_progress_dimensions_are_locked_un_eafcd432" />
          </span>
        </div>
      )}
    </motion.div>
  );
}
