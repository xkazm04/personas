// Analog clock face — main visual for time-triggered use cases.
// Renders:
//   • day ring across the top (weekly preset only)
//   • 60 tick marks with major/hour/minute gradation
//   • numeric labels at 12 / 3 / 6 / 9
//   • animated hour hand rotating to the configured hour
//   • fixed minute hand at 12 (picker only stores :00)
//   • amber sweeping second hand during test firing
//   • digital readout below the clock

import { motion } from 'framer-motion';
import type { TriggerDisplay } from './ucPickerTypes';

const WEEK_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export function ClockVariant({ display, firing }: { display: TriggerDisplay; firing: boolean }) {
  const hourAngle = ((display.hour % 12) / 12) * 360;
  const showDayRing = display.weekday !== null;
  return (
    <>
      {showDayRing && (
        <div className="flex items-center justify-between px-1 -mt-0.5 mb-1.5" aria-hidden>
          {WEEK_LETTERS.map((d, i) => {
            const on = i === display.weekday;
            return (
              <span
                key={i}
                className={`relative inline-flex items-center justify-center leading-none font-mono text-[22px] font-bold transition-colors ${
                  on ? 'text-primary' : 'text-foreground/25'
                }`}
                style={on ? { textShadow: '0 0 10px color-mix(in srgb, var(--color-primary) 60%, transparent)' } : undefined}
              >
                {d}
                {on && (
                  <span
                    aria-hidden
                    className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary"
                  />
                )}
              </span>
            );
          })}
        </div>
      )}

      <div className="relative flex-1 flex items-center justify-center min-h-0">
        <svg viewBox="0 0 120 120" className="w-full h-full max-w-[120px] max-h-[120px]">
          <defs>
            <radialGradient id="uc-clock-face" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="color-mix(in srgb, var(--color-primary) 10%, var(--color-background))" />
              <stop offset="100%" stopColor="color-mix(in srgb, var(--color-primary) 2%, var(--color-background))" />
            </radialGradient>
          </defs>
          <circle cx={60} cy={60} r={56} fill="none" stroke="color-mix(in srgb, var(--color-foreground) 12%, transparent)" strokeWidth={1.5} />
          <circle cx={60} cy={60} r={52} fill="url(#uc-clock-face)" stroke="var(--color-primary)" strokeOpacity={0.35} strokeWidth={1.2} />

          {Array.from({ length: 60 }).map((_, i) => {
            const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
            const isMajor = i % 15 === 0;
            const isHour = i % 5 === 0;
            const outerR = 50;
            const innerR = isMajor ? 40 : isHour ? 44 : 47;
            return (
              <line
                key={i}
                x1={60 + outerR * Math.cos(angle)}
                y1={60 + outerR * Math.sin(angle)}
                x2={60 + innerR * Math.cos(angle)}
                y2={60 + innerR * Math.sin(angle)}
                stroke="var(--color-primary)"
                strokeOpacity={isMajor ? 0.7 : isHour ? 0.4 : 0.2}
                strokeWidth={isMajor ? 2 : isHour ? 1.2 : 0.7}
                strokeLinecap="round"
              />
            );
          })}

          {[
            { label: '12', x: 60, y: 20 },
            { label: '3', x: 97, y: 64 },
            { label: '6', x: 60, y: 105 },
            { label: '9', x: 23, y: 64 },
          ].map((n) => (
            <text
              key={n.label}
              x={n.x}
              y={n.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-foreground/75"
              style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}
            >
              {n.label}
            </text>
          ))}

          {/* Hour hand — rotates to the configured hour */}
          <motion.line
            x1={60}
            y1={60}
            x2={60}
            y2={28}
            stroke="var(--color-primary)"
            strokeWidth={4}
            strokeLinecap="round"
            style={{ originX: '60px', originY: '60px' }}
            initial={{ rotate: hourAngle }}
            animate={{ rotate: hourAngle }}
            transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
          />
          <line x1={60} y1={60} x2={60} y2={14} stroke="var(--color-foreground)" strokeOpacity={0.75} strokeWidth={2} strokeLinecap="round" />
          {firing && (
            <motion.line
              x1={60}
              y1={60}
              x2={60}
              y2={16}
              stroke="var(--color-status-warning)"
              strokeWidth={1.5}
              strokeLinecap="round"
              style={{ originX: '60px', originY: '60px' }}
              animate={{ rotate: 360 }}
              transition={{ duration: 2, ease: 'linear', repeat: Infinity }}
            />
          )}
          <circle cx={60} cy={60} r={4} fill="var(--color-primary)" />
          <circle cx={60} cy={60} r={2} fill="var(--color-background)" />
        </svg>
      </div>

      <div className="mt-1 flex flex-col items-center gap-0">
        <div className="text-[18px] font-bold tracking-tight text-foreground font-mono leading-tight tabular-nums">
          {display.primary} {display.secondary}
        </div>
        <div className="text-[10px] text-foreground/55 leading-tight">{display.detail}</div>
      </div>
    </>
  );
}
