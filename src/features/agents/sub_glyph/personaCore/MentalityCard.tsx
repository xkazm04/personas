/** MentalityCard — a rich archetype snapshot card for the (now wider) Mentality
 *  column. A large traced, self-drawing AVATAR (via /motionize; falls back to the
 *  lucide glyph), the name + tagline, and a SIGNATURE STRIP of the archetype's
 *  dominant traits rendered as their axis-coloured icons — so each card reads as a
 *  distinct persona at a glance. Picking one seeds disposition + conflict + those
 *  dominant traits (applyPreset).
 */
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { MotionizedGlyph } from "@/features/shared/components/display/MotionizedGlyph";
import { coreIcon, ARCHETYPE_TRAITS, traitById, TRAIT_AXES } from "./catalog";
import { ARCHETYPE_GLYPHS } from "./archetypeGlyphData";
import type { Archetype } from "./types";

const axisColorOf = (axisId: string) => TRAIT_AXES.find((a) => a.id === axisId)?.color ?? "#60A5FA";

export function MentalityCard({ archetype: a, active, onSelect }: { archetype: Archetype; active: boolean; onSelect: () => void }) {
  const glyph = ARCHETYPE_GLYPHS[a.id];
  const Icon = coreIcon(a.icon);
  const traits = (ARCHETYPE_TRAITS[a.id] ?? []).flatMap((id) => { const t = traitById(id); return t ? [t] : []; });
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`core-snapshot-${a.id}`}
      aria-pressed={active}
      className={`group relative flex items-center gap-3.5 p-3 rounded-card border text-left transition-colors cursor-pointer ${
        active ? "" : "border-card-border/60 hover:bg-secondary/30 hover:border-card-border"
      }`}
      style={active ? { borderColor: colorWithAlpha(a.color, 0.55), background: colorWithAlpha(a.color, 0.1) } : undefined}
    >
      {/* Avatar — the signature AI-persona head glyph, drawing in on view */}
      <span
        className="relative shrink-0 w-28 h-28 rounded-card flex items-center justify-center overflow-hidden"
        style={{ background: colorWithAlpha(a.color, active ? 0.16 : 0.06), boxShadow: `inset 0 0 0 1px ${colorWithAlpha(a.color, active ? 0.4 : 0.2)}` }}
      >
        {glyph ? (
          <MotionizedGlyph data={glyph.data} viewBox={glyph.viewBox} spread={0.9} className="w-[108px] h-[108px]" />
        ) : (
          <Icon className="w-9 h-9" style={{ color: a.color }} />
        )}
      </span>

      {/* Name + tagline + signature trait strip */}
      <span className="min-w-0 flex flex-col gap-1.5">
        <span className="flex flex-col">
          <span className="typo-title-lg text-foreground truncate" style={active ? { color: a.color } : undefined}>{a.name}</span>
          {a.tagline && <span className="typo-caption line-clamp-2 leading-snug">{a.tagline}</span>}
        </span>
        {traits.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {traits.map((t) => {
              const TI = t.icon;
              const c = axisColorOf(t.axis);
              return (
                <span key={t.id} title={t.label} className="w-5 h-5 rounded-input flex items-center justify-center shrink-0" style={{ background: colorWithAlpha(c, 0.16) }}>
                  <TI className="w-3 h-3" style={{ color: c }} />
                </span>
              );
            })}
          </span>
        )}
      </span>
    </button>
  );
}
