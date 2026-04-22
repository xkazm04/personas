import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { CATEGORY_META, FALLBACK_CATEGORY } from '../QuestionnaireFormGridConfig';
import { QUESTIONNAIRE_CONSTELLATION_STARS } from './questionnaireConstellationStars';
import { polar, angleForIndex } from './questionnaireHelpers';
import type { QuestionnaireCategoryProgress, QuestionnairePulse } from './types';

const ORBIT_R = 210;
const CORE_R = 52;

/**
 * Semi-transparent full-pane SVG rendered behind the hero question card.
 * Decorative only (pointer-events-none): persona-core at centre, orbital
 * ring with category planets, animated halo on the current category, pulse
 * particles on answer commit. Every motion responds to the questionnaire's
 * state so the background reinforces "the persona is forming" without
 * competing with the foreground.
 */
export function QuestionnaireBackgroundConstellation({
  categoryKeys,
  categoryProgress,
  currentCat,
  progressPct,
  pulses,
}: {
  categoryKeys: string[];
  categoryProgress: Record<string, QuestionnaireCategoryProgress>;
  currentCat: string;
  progressPct: number;
  pulses: QuestionnairePulse[];
}) {
  const coreCircumference = 2 * Math.PI * (CORE_R + 7);
  return (
    <svg
      viewBox="-350 -280 700 560"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 w-full h-full text-primary pointer-events-none"
      style={{ opacity: 0.22 }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="qc-bg-core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.55} />
          <stop offset="45%" stopColor="currentColor" stopOpacity={0.2} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </radialGradient>
        <filter id="qc-bg-pulse-blur">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>

      {/* Ambient stars */}
      <g opacity={0.7}>
        {QUESTIONNAIRE_CONSTELLATION_STARS.map((s, i) => (
          <motion.circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r}
            className="text-foreground/60"
            fill="currentColor"
            animate={{ opacity: [0.15, 0.55, 0.15] }}
            transition={{ duration: s.dur, delay: s.delay, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </g>

      {/* Orbit ring */}
      <circle cx={0} cy={0} r={ORBIT_R} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 7" className="text-foreground" />

      {/* Beam — core → current-category planet */}
      <AnimatePresence mode="wait">
        {(() => {
          const i = categoryKeys.indexOf(currentCat);
          if (i < 0) return null;
          const a = angleForIndex(i, categoryKeys.length);
          const p = polar(a, ORBIT_R);
          return (
            <motion.line
              key={currentCat}
              x1={0} y1={0} x2={p.x} y2={p.y}
              stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.2}
              className={CATEGORY_META[currentCat]?.color ?? FALLBACK_CATEGORY.color}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          );
        })()}
      </AnimatePresence>

      {/* Core glow + progress arc + body */}
      <motion.circle cx={0} cy={0} r={CORE_R + 40} fill="url(#qc-bg-core-glow)" animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} />
      <circle cx={0} cy={0} r={CORE_R + 7} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2.5} className="text-foreground" />
      <motion.circle
        cx={0} cy={0} r={CORE_R + 7}
        fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" transform="rotate(-90)"
        className="text-primary"
        style={{ strokeDasharray: coreCircumference, strokeDashoffset: coreCircumference * (1 - progressPct) }}
        initial={false}
        animate={{ strokeDashoffset: coreCircumference * (1 - progressPct) }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
      <motion.circle cx={0} cy={0} r={CORE_R} className="text-primary" fill="currentColor" fillOpacity={0.92} animate={{ r: [CORE_R, CORE_R + 2.5, CORE_R] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }} />
      <circle cx={0} cy={0} r={CORE_R - 14} className="text-primary-foreground" fill="currentColor" fillOpacity={0.25} />
      <g transform="translate(-12 -12)">
        <Sparkles width={24} height={24} className="text-primary-foreground" />
      </g>

      {/* Pulse particles — planet → core on answer commit */}
      <AnimatePresence>
        {pulses.map((p) => {
          const i = categoryKeys.indexOf(p.cat);
          if (i < 0) return null;
          const a = angleForIndex(i, categoryKeys.length);
          const from = polar(a, ORBIT_R);
          const meta = CATEGORY_META[p.cat] ?? FALLBACK_CATEGORY;
          return (
            <motion.circle
              key={p.id}
              r={6}
              fill="currentColor"
              className={meta.color}
              filter="url(#qc-bg-pulse-blur)"
              initial={{ cx: from.x, cy: from.y, opacity: 0, scale: 0.4 }}
              animate={{ cx: 0, cy: 0, opacity: [0, 1, 1, 0], scale: [0.4, 1.35, 1, 0.6] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, ease: [0.33, 0.67, 0.25, 1.0] }}
            />
          );
        })}
      </AnimatePresence>

      {/* Planets with progress arcs and current-category halo */}
      {categoryKeys.map((cat, i) => {
        const a = angleForIndex(i, categoryKeys.length);
        const pos = polar(a, ORBIT_R);
        const meta = CATEGORY_META[cat] ?? FALLBACK_CATEGORY;
        const prog = categoryProgress[cat]!;
        const isCurrent = cat === currentCat;
        const planetR = 18 + Math.min(10, prog.total * 1.2);
        const ringR = planetR + 4;
        const circumference = 2 * Math.PI * ringR;
        const complete = prog.pct === 1 && prog.total > 0;
        return (
          <g key={cat}>
            {isCurrent && (
              <motion.circle
                cx={pos.x} cy={pos.y} r={planetR + 14}
                fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="3 4"
                className={meta.color}
                animate={{ opacity: [0.4, 0.85, 0.4], rotate: 360 }}
                transition={{
                  opacity: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' },
                  rotate: { duration: 30, repeat: Infinity, ease: 'linear' },
                }}
                style={{ transformOrigin: `${pos.x}px ${pos.y}px` }}
              />
            )}
            <circle cx={pos.x} cy={pos.y} r={ringR} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2} className="text-foreground" />
            <motion.circle
              cx={pos.x} cy={pos.y} r={ringR}
              fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
              className={meta.color}
              style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - prog.pct), transform: `rotate(-90deg)`, transformOrigin: `${pos.x}px ${pos.y}px` }}
              initial={false}
              animate={{ strokeDashoffset: circumference * (1 - prog.pct) }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
            <motion.circle
              cx={pos.x} cy={pos.y} r={planetR}
              fill="currentColor"
              fillOpacity={isCurrent ? 0.4 : complete ? 0.3 : 0.16}
              stroke="currentColor"
              strokeOpacity={isCurrent ? 0.9 : complete ? 0.65 : 0.35}
              strokeWidth={isCurrent ? 2 : 1.2}
              className={meta.color}
              animate={{ scale: isCurrent ? 1.08 : 1 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              style={{ transformOrigin: `${pos.x}px ${pos.y}px` }}
            />
            <g transform={`translate(${pos.x - 10} ${pos.y - 10})`} className={meta.color}>
              <meta.Icon width={20} height={20} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
