/**
 * The brain map's two pieces of geometry: a stage NODE and the CHANNEL between
 * two stages.
 *
 * Both carry their number as shape rather than as prose. The node is sized and
 * filled to its share of the busiest stage; the channel is filled to the
 * fraction of the previous stage that reached the next one. A reader who never
 * hovers anything still sees where the volume is and where it drops.
 *
 * Extracted from `BrainMapVariant` only to keep that file under the repo's
 * 200-line component ceiling — it has no other caller and no state.
 */

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { HubEntry } from '../hubContract';

export interface MapStageRole {
  text: string;
  bg: string;
  border: string;
  /** A stronger wash than `bg`, used for the proportional fill inside the node. */
  fill: string;
}

/** `Id` is threaded so a caller's stage-id union survives the round trip and
 *  can index its own i18n table without a cast. */
export interface MapStage<Id extends string = string> {
  id: Id;
  Icon: LucideIcon;
  role: MapStageRole;
  count: number;
  /** Rows the stage reveals when opened. Empty for a stage with no rows of its own. */
  entries: HubEntry[];
}

/** Node diameter in rem: a floor so a zero stage is still readable, plus its share. */
const MIN_REM = 3.25;
const SPAN_REM = 2.5;

export function MapStageNode({ stage, label, peak, open, reduced, index, onToggle }: {
  stage: MapStage;
  label: string;
  peak: number;
  open: boolean;
  reduced: boolean;
  index: number;
  onToggle: () => void;
}) {
  const ratio = peak > 0 ? Math.min(1, stage.count / peak) : 0;
  const size = MIN_REM + ratio * SPAN_REM;

  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut', delay: reduced ? 0 : index * 0.05 }}
      className="group flex flex-col items-center gap-1 rounded-card px-1 py-1 focus-ring"
    >
      <span
        className={`relative flex items-center justify-center rounded-full border overflow-hidden transition-all ${stage.role.bg} ${
          open ? `${stage.role.border} ring-2 ring-primary/40` : `${stage.role.border} group-hover:ring-2 group-hover:ring-primary/20`
        }`}
        style={{ width: `${size}rem`, height: `${size}rem` }}
      >
        <span
          className={`absolute inset-x-0 bottom-0 ${stage.role.fill} transition-all duration-500`}
          style={{ height: `${Math.round(ratio * 100)}%` }}
          aria-hidden="true"
        />
        <span className="relative flex flex-col items-center leading-none gap-0.5">
          <stage.Icon className={`w-4 h-4 ${stage.role.text}`} />
          <span className={`typo-data tabular-nums ${stage.role.text}`}>{stage.count}</span>
        </span>
      </span>
      <span className="typo-label text-foreground">{label}</span>
    </motion.button>
  );
}

/**
 * The filled channel between two stages. `ratio` is what survived the step, so
 * a half-empty channel IS the attrition — no sentence restates it.
 */
export function MapConnector({ ratio, label }: { ratio: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <Tooltip content={label}>
      <span className="flex-1 min-w-[1.25rem] max-w-[4rem] flex items-center self-center" aria-label={label}>
        <span className="relative h-1.5 w-full rounded-full bg-secondary/60 overflow-hidden">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/70 to-primary/25 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>
    </Tooltip>
  );
}
