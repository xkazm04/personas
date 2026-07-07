/**
 * Explore Variant 3 — "Persona Constellation" (characteristics-first).
 *
 * Hypothesis: sometimes you're choosing a TEAMMATE, not a tool. Show the entire
 * catalog as ONE spatial map in trait-space (x = reactive→proactive,
 * y = assistive→autonomous, size = popularity, colour = archetype). Pick an
 * archetype ("Guardian", "Scout"…) and its stars light up while the rest dim —
 * so "one map of everything" never overwhelms because character guides the eye.
 * This is the literal "map view" the brief asks for, and the most spatial /
 * high-wow of the three.
 *
 * PROTOTYPE: hardcoded English, mock data.
 */
import { useState } from 'react';
import { ARCHETYPES, ITEMS, archetypeById, type ExploreItem } from '../exploreMockData';
import { popularityWeight } from '../shared/exploreBits';
import { ExploreItemCard } from '../shared/ExploreItemCard';

export function PersonaConstellation({ onSelect }: { onSelect?: (i: ExploreItem) => void }) {
  const [archetype, setArchetype] = useState<string | null>(null);
  const [hover, setHover] = useState<ExploreItem | null>(null);
  const selected = archetype ? archetypeById(archetype) : null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="typo-heading-lg font-semibold text-foreground">What kind of teammate?</h2>
        <p className="typo-body text-foreground opacity-80">
          Every agent, mapped by temperament. Pick a character to light up its constellation.
        </p>
      </div>

      {/* Archetype legend / filter */}
      <div className="flex flex-wrap gap-2">
        {ARCHETYPES.map((a) => {
          const active = archetype === a.id;
          return (
            <button
              key={a.id}
              onClick={() => setArchetype(active ? null : a.id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input typo-caption border transition-all"
              style={{
                borderColor: active ? a.color : 'transparent',
                backgroundColor: active ? `${a.color}22` : 'rgba(127,127,127,0.08)',
                color: active ? a.color : undefined,
              }}
              title={a.tagline}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: a.color }} />
              <span className={active ? '' : 'text-foreground opacity-80'}>{a.label}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <p className="typo-body italic text-foreground" style={{ color: selected.color }}>
          "{selected.tagline}"
        </p>
      )}

      {/* The constellation */}
      <div className="relative w-full rounded-2xl border border-primary/10 bg-gradient-to-b from-secondary/10 to-transparent overflow-hidden"
        style={{ height: 520 }}>
        <AxisLabels />
        {ITEMS.map((item, idx) => {
          const dim = archetype != null && item.archetype !== archetype;
          const c = archetypeById(item.archetype)!.color;
          const size = 12 + 30 * popularityWeight(item.popularity);
          // trait-space position with tiny deterministic jitter to de-overlap
          const jx = ((idx * 37) % 7) - 3;
          const jy = ((idx * 53) % 7) - 3;
          const left = 6 + item.traits.proactive * 86 + jx;
          const top = 8 + (1 - item.traits.autonomy) * 80 + jy;
          return (
            <button
              key={item.id}
              onClick={() => onSelect?.(item)}
              onMouseEnter={() => setHover(item)}
              onMouseLeave={() => setHover((h) => (h === item ? null : h))}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-300 hover:z-20"
              style={{
                left: `${left}%`, top: `${top}%`, width: size, height: size,
                backgroundColor: c,
                opacity: dim ? 0.15 : 0.9,
                boxShadow: dim ? 'none' : `0 0 ${size * 0.6}px ${c}99`,
                transform: `translate(-50%,-50%) scale(${dim ? 0.7 : 1})`,
              }}
              aria-label={item.name}
            />
          );
        })}
        {hover && <HoverLabel item={hover} />}
      </div>

      {/* Selected archetype's roster below the map */}
      {selected && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ITEMS.filter((i) => i.archetype === archetype)
            .sort((a, b) => b.popularity - a.popularity)
            .map((i) => (
              <ExploreItemCard key={i.id} item={i} accent={selected.color} onSelect={onSelect} />
            ))}
        </div>
      )}
    </div>
  );
}

function AxisLabels() {
  return (
    <>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 -rotate-90 typo-caption text-foreground opacity-40">Assistive → Autonomous</span>
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 typo-caption text-foreground opacity-40">Reactive → Proactive</span>
    </>
  );
}

function HoverLabel({ item }: { item: ExploreItem }) {
  const c = archetypeById(item.archetype)!.color;
  const left = 6 + item.traits.proactive * 86;
  const top = 8 + (1 - item.traits.autonomy) * 80;
  return (
    <div
      className="absolute z-30 -translate-x-1/2 pointer-events-none px-2 py-1 rounded-input bg-background/95 border border-primary/20 whitespace-nowrap"
      style={{ left: `${left}%`, top: `calc(${top}% + ${14}px)` }}
    >
      <span className="typo-caption font-medium" style={{ color: c }}>{item.name}</span>
      <span className="typo-caption text-foreground opacity-70"> · {item.popularity} adopts</span>
    </div>
  );
}
