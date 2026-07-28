// The Backlog focus deck's card — moved out of the deleted Dev Tools
// `IdeaTriagePage` essentially verbatim (drag physics, ±15° rotation, the
// reject/accept stamps, the border glow, the 150px commit threshold, the fling
// exit and the stack depth transform), retyped from the old page-local
// `TriageIdea` to the shared `BacklogIdea`.
//
// Two deliberate changes came with the move:
//   • The agent rank / accept-rate line is GONE. It rewarded plausibility, not
//     outcome, and the sensor scoreboard scores the same question honestly.
//   • Category and E/I/R labels come from the Backlog's own label helpers, so a
//     card and its table row can never disagree about what a category is called.
//
// Badge components are still imported from `sub_triage` / `sub_scanner`: the
// sensor palette is defined once next to the badge that renders it, and the
// Backlog must label origins identically to the findings surfaces.
import { motion, useMotionValue, useTransform } from 'framer-motion';

import { CATEGORY_TW, DEFAULT_CATEGORY_TW } from '@/features/plugins/dev-tools/constants/ideaColors';
import { FindingBadge, VerdictChip } from '@/features/plugins/dev-tools/sub_triage/findings/FindingBadge';
import { LevelBadge, ValueBadge } from '@/features/plugins/dev-tools/constants/ideaBadges';
import { useTranslation } from '@/i18n/useTranslation';

import type { BacklogIdea } from './backlogModel';

/** Horizontal travel (px) at which a drag commits to a verdict. */
export const SWIPE_THRESHOLD = 150;

export function SwipeCard({
  idea,
  isTop,
  stackIndex,
  categoryLabel,
  onSwipe,
}: {
  idea: BacklogIdea;
  isTop: boolean;
  /** 0 = the card being acted on; deeper cards shrink, drop and fade. */
  stackIndex: number;
  categoryLabel: (key: string) => string;
  onSwipe: (direction: 'left' | 'right') => void;
}) {
  const { t } = useTranslation();
  const r = t.overview.review;
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 0, 300], [-15, 0, 15]);
  const rejectOpacity = useTransform(x, [-SWIPE_THRESHOLD, -30, 0], [1, 0, 0]);
  const acceptOpacity = useTransform(x, [0, 30, SWIPE_THRESHOLD], [0, 0, 1]);

  // Border glow tracks the drag so the verdict is legible before release.
  const borderColor = useTransform(
    x,
    [-SWIPE_THRESHOLD, -30, 0, 30, SWIPE_THRESHOLD],
    [
      'rgba(239, 68, 68, 0.5)',
      'rgba(239, 68, 68, 0)',
      'rgba(255,255,255,0)',
      'rgba(34, 197, 94, 0)',
      'rgba(34, 197, 94, 0.5)',
    ],
  );

  const catTw = CATEGORY_TW[idea.category] ?? DEFAULT_CATEGORY_TW;

  const scale = 1 - stackIndex * 0.04;
  const yOffset = stackIndex * 8;
  const opacity = 1 - stackIndex * 0.15;

  const levels: [string, number][] = [
    [r.backlog_effort_title, idea.effort],
    [r.backlog_impact_title, idea.impact],
    [r.backlog_risk_title, idea.risk],
  ];

  return (
    <motion.div
      style={isTop ? { x, rotate, borderColor, zIndex: 10 - stackIndex } : { zIndex: 10 - stackIndex }}
      initial={{ scale, y: yOffset, opacity }}
      animate={{ scale, y: yOffset, opacity }}
      exit={isTop ? {
        x: x.get() > 0 ? 400 : -400,
        opacity: 0,
        rotate: x.get() > 0 ? 20 : -20,
        transition: { duration: 0.3 },
      } : { opacity: 0, scale: 0.9 }}
      drag={isTop ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      onDragEnd={(_, info) => {
        if (info.offset.x > SWIPE_THRESHOLD) onSwipe('right');
        else if (info.offset.x < -SWIPE_THRESHOLD) onSwipe('left');
      }}
      className={`absolute inset-0 border-2 rounded-2xl bg-background shadow-elevation-3 ${isTop ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'}`}
    >
      {/* Swipe stamps */}
      {isTop && (
        <>
          <motion.div
            style={{ opacity: rejectOpacity }}
            className="absolute top-6 left-6 z-20 px-4 py-2 rounded-modal border-2 border-red-500 text-red-500 font-bold typo-heading-lg uppercase -rotate-12"
          >
            {r.backlog_swipe_reject}
          </motion.div>
          <motion.div
            style={{ opacity: acceptOpacity }}
            className="absolute top-6 right-6 z-20 px-4 py-2 rounded-modal border-2 border-emerald-500 text-emerald-500 font-bold typo-heading-lg uppercase rotate-12"
          >
            {r.backlog_swipe_accept}
          </motion.div>
        </>
      )}

      <div className="p-6 h-full flex flex-col">
        {/* Provenance + category + effort/impact/risk. A sensor finding leads
            with its origin badge (and its evidence); a scanner idea has none. */}
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {idea.origin && (
            <>
              <FindingBadge origin={idea.origin} evidence={idea.evidence} />
              <VerdictChip verifyState={idea.verifyState} />
            </>
          )}
          <span className={`rounded-full px-2.5 py-0.5 typo-caption font-medium ${catTw.bg} ${catTw.text} border ${catTw.border}`}>
            {categoryLabel(idea.category)}
          </span>
          <ValueBadge idea={idea} />
          {levels.map(([label, value]) => (
            <LevelBadge key={label} label={label} value={value} />
          ))}
        </div>

        <h3 className="typo-heading-lg font-semibold text-primary mb-2">{idea.title}</h3>
        {idea.projectName && (
          <p className="typo-caption text-muted-foreground mb-2">{idea.projectName}</p>
        )}
        <p className="typo-body text-foreground mb-4 leading-relaxed flex-1 min-h-0 overflow-y-auto">
          {idea.description || r.backlog_no_description}
        </p>

        {idea.reasoning && (
          <div className="bg-primary/5 rounded-modal p-3">
            <p className="typo-caption uppercase tracking-wider text-primary font-medium mb-1">
              {r.backlog_detail_reasoning}
            </p>
            <p className="typo-body text-foreground leading-relaxed">{idea.reasoning}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
