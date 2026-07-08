/** SnapshotColumn — the mentality presets as a vertical card list (the right
 *  column). Each archetype is a card with a traced, self-drawing AVATAR (via the
 *  /motionize skill — see archetypeGlyphData.ts), its name + tagline. Picking one
 *  seeds disposition + conflict + dominant traits (applyPreset). Falls back to the
 *  lucide glyph for any archetype whose avatar hasn't been traced yet. */
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { MotionizedGlyph } from "@/features/teams/sub_teamWorkspace/MotionizedGlyph";
import { coreIcon } from "./catalog";
import { ARCHETYPE_GLYPHS } from "./archetypeGlyphData";
import type { PersonaCore } from "./types";

export function SnapshotColumn({ core }: { core: PersonaCore }) {
  return (
    <div className="flex flex-col gap-2">
      {core.archetypes.map((a) => {
        const on = core.state.archetypeId === a.id;
        const glyph = ARCHETYPE_GLYPHS[a.id];
        const Icon = coreIcon(a.icon);
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => core.applyPreset(a)}
            data-testid={`core-snapshot-${a.id}`}
            aria-pressed={on}
            className={`group relative flex items-center gap-3 p-2 rounded-card border text-left transition-colors cursor-pointer ${
              on ? "" : "border-card-border/60 hover:bg-secondary/30 hover:border-card-border"
            }`}
            style={on ? { borderColor: colorWithAlpha(a.color, 0.55), background: colorWithAlpha(a.color, 0.1) } : undefined}
          >
            {/* Avatar */}
            <span
              className="relative shrink-0 w-12 h-12 rounded-input flex items-center justify-center overflow-hidden"
              style={{ background: colorWithAlpha(a.color, on ? 0.18 : 0.08), boxShadow: `inset 0 0 0 1px ${colorWithAlpha(a.color, 0.25)}` }}
            >
              {glyph ? (
                <MotionizedGlyph data={glyph.data} viewBox={glyph.viewBox} spread={0.8} className="w-11 h-11" />
              ) : (
                <Icon className="w-5 h-5" style={{ color: a.color }} />
              )}
            </span>
            {/* Name + tagline */}
            <span className="min-w-0 flex flex-col">
              <span className="typo-body text-foreground truncate" style={on ? { color: a.color } : undefined}>{a.name}</span>
              {a.tagline && <span className="typo-caption text-foreground opacity-70 line-clamp-2 leading-tight">{a.tagline}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
