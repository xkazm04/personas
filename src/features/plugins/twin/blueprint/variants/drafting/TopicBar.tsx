import type { Ref } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { BlueprintTopic } from '../../blueprintContract';
import { BreakMark } from './Lettering';
import { TOPIC_SCALE_MAX, TOPIC_TIER_MARKS, onScale } from './draftingTwinModel';
import DrawFrame from './draw/DrawFrame';
import Write, { WriteNumber } from './draw/Write';

/**
 * One training topic as a scale bar: approved answers in ink, those awaiting
 * review hatched after them, on a declared scale of twice the "covered"
 * threshold with the tier thresholds ticked across it. A thin topic's scale
 * is dashed (still pending), a covered one solid. Where the column is wide the
 * figures sit on the name's line; in a narrow one (beside the card) they move
 * beside the bar so the name keeps the whole line (container query on
 * `.twd-topics`, both copies rendered, one shown). When the last answer
 * landed here the fill is drawn in again (`playKey`), the way the pen inks a
 * part. In the draw-in the topic is a container: its scale is a frame (the
 * tier marks a frame inside it), then the name and the figures are lettered,
 * the bar runs out and the hatch sweeps after it.
 */
export default function TopicBar({
  topic,
  label,
  detailed = false,
  targeted = false,
  playKey,
  reduced,
  markRef,
  penRef,
}: {
  topic: BlueprintTopic;
  label: string;
  /** L2: the tier is written out. */
  detailed?: boolean;
  targeted?: boolean;
  playKey?: string | null;
  reduced: boolean;
  markRef?: Ref<HTMLDivElement>;
  /** Where the pen sets down on this topic: past the end of its scale line, clear of the name and the figures. */
  penRef?: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const approved = onScale(topic.approved, TOPIC_SCALE_MAX);
  const total = onScale(topic.approved + topic.awaiting, TOPIC_SCALE_MAX);
  const awaitingShare = Math.max(0, total.share - approved.share);
  const replay = targeted && !!playKey && !reduced;

  return (
    <div
      ref={markRef}
      data-topic={topic.id}
      data-tier={topic.tier}
      data-delta-target={targeted || undefined}
      data-draw-scope=""
      className={`flex min-w-0 flex-col gap-0.5 rounded-interactive px-1 py-0.5 ${targeted ? 'twd-target' : ''}`}
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="min-w-0 flex-1 typo-body text-foreground">
          <Write text={label} />
        </span>
        {detailed && <Write text={t.twin.blueprint.tiers[topic.tier]} className="shrink-0 typo-caption" />}
        <Figures topic={topic} className="twd-fig-wide" />
      </div>
      <div className="relative flex items-center gap-2">
        {/* The pen's anchor: just past the end of this line, so the nib and its
            barrel sit in the margin rather than over the name or the figures. */}
        <span ref={penRef} aria-hidden className="pointer-events-none absolute -right-3.5 top-full h-2 w-7" />
        <div className="relative h-2.5 min-w-0 flex-1" style={{ border: '1px solid transparent' }}>
          <DrawFrame stroke={topic.tier === 'covered' ? 'var(--ink)' : 'var(--ink-dim)'} dash={topic.tier === 'thin' ? '4 3' : undefined} />
          <motion.div
            key={replay ? playKey : 'still'}
            aria-hidden
            className="absolute inset-y-0 left-0 flex origin-left"
            style={{ width: `${total.share * 100}%` }}
            initial={replay ? { scaleX: 0 } : false}
            animate={replay ? { scaleX: 1 } : undefined}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.35 }}
          >
            <span data-draw="extend" className="h-full" style={{ width: total.share ? `${(approved.share / total.share) * 100}%` : 0, background: 'var(--ink)' }} />
            {awaitingShare > 0 && <span data-draw="sweep" className="twd-hatch-ink h-full flex-1" />}
          </motion.div>
          {TOPIC_TIER_MARKS.map((n) => (
            <i
              key={n}
              aria-hidden
              data-draw="frame"
              data-draw-wipe="y"
              className="absolute -top-1 h-[calc(100%+0.5rem)] w-px"
              style={{ left: `${(n / TOPIC_SCALE_MAX) * 100}%`, background: 'var(--ink-dim)' }}
            />
          ))}
        </div>
        {total.broken && <BreakMark height={12} />}
        <Figures topic={topic} className="twd-fig-narrow" />
      </div>
    </div>
  );
}

/** Approved answers, and those awaiting review after a plus. */
function Figures({ topic, className }: { topic: BlueprintTopic; className: string }) {
  return (
    <span className={`shrink-0 items-baseline gap-1 ${className}`}>
      <WriteNumber value={topic.approved} className="typo-data text-foreground" />
      {topic.awaiting > 0 && (
        <Numeric className="typo-caption">
          <Write text={`+${topic.awaiting}`} />
        </Numeric>
      )}
    </span>
  );
}
