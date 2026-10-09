// PROTOTYPE ROUND (spark council-readout, direction H). What stays of the
// galaxy while a council is open as a cover: a primary glow behind the
// card, a few faint orbit rings and a quiet scatter of stars, seeded by the
// subject so one council always sits under the same sky. Decorative only.
import { useMemo } from 'react';

function stars(seed: string, count: number) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h >>> 0) % 10000) / 10000;
  };
  return Array.from({ length: count }, () => ({
    x: next() * 100,
    y: next() * 100,
    r: 0.6 + next() * 1.4,
    o: 0.2 + next() * 0.5,
  }));
}

export function Backdrop({ seed }: { seed: string }) {
  const field = useMemo(() => stars(seed, 90), [seed]);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 60% 55% at 50% 45%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 70%)',
        }}
      />
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 100 100">
        {[22, 34, 48, 64].map((r) => (
          <ellipse
            key={r}
            cx="50"
            cy="47"
            rx={r * 1.1}
            ry={r * 0.62}
            fill="none"
            stroke="color-mix(in srgb, var(--primary) 22%, transparent)"
            strokeWidth="0.08"
            strokeDasharray={r > 40 ? '0.4 0.9' : undefined}
          />
        ))}
        {field.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r * 0.12} fill="var(--foreground)" fillOpacity={s.o * 0.5} />
        ))}
      </svg>
    </div>
  );
}
