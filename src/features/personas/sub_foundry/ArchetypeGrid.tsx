import { Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { Archetype } from '@/api/archetypes';
import { foundryIcon } from './foundryIcons';

interface ArchetypeGridProps {
  archetypes: Archetype[];
  selectedId: string | null;
  onSelect: (a: Archetype) => void;
}

/** Extract the mentality preview fields from the archetype's opaque v3
 *  persona payload. Defensive — missing fields degrade to empty strings. */
function personaPreview(a: Archetype): { stance: string; role: string; risk: number; speed: number } {
  const p = a.persona as Record<string, unknown>;
  const core = (p.core ?? {}) as Record<string, unknown>;
  const identity = (p.identity ?? {}) as Record<string, unknown>;
  return {
    stance: typeof core.stance === 'string' ? core.stance : '',
    role: typeof identity.role === 'string' ? identity.role : '',
    risk: typeof core.riskTolerance === 'number' ? core.riskTolerance : 0.5,
    speed: typeof core.speedVsQuality === 'number' ? core.speedVsQuality : 0.5,
  };
}

/**
 * Foundation palette — the mentality archetype cards. Each card shows the
 * archetype's role, stance excerpt, and the two most legible core dials
 * (risk appetite, speed vs quality) as compact meters.
 */
export function ArchetypeGrid({ archetypes, selectedId, onSelect }: ArchetypeGridProps) {
  const { t } = useTranslation();
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
      role="radiogroup"
      aria-label={t.foundry.archetype_group_aria}
    >
      {archetypes.map((a) => {
        const Icon = foundryIcon(a.icon);
        const active = selectedId === a.id;
        const preview = personaPreview(a);
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`foundry-archetype-${a.id}`}
            onClick={() => onSelect(a)}
            className={`relative text-left p-4 rounded-card border transition-all cursor-pointer focus-ring ${
              active
                ? 'border-primary/55 bg-primary/[0.07] shadow-elevation-2'
                : 'border-card-border bg-secondary/30 hover:border-foreground/25 hover:bg-secondary/50'
            }`}
          >
            {active && (
              <span className="absolute top-3 right-3 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground">
                <Check className="w-3 h-3" />
              </span>
            )}
            <div className="flex items-center gap-2.5 mb-2">
              <span
                className="flex items-center justify-center rounded-card shrink-0"
                style={{
                  width: 38,
                  height: 38,
                  background: colorWithAlpha(a.color, 0.14),
                  border: `1px solid ${colorWithAlpha(a.color, 0.4)}`,
                }}
              >
                <Icon className="w-4.5 h-4.5" style={{ color: a.color }} />
              </span>
              <div className="min-w-0">
                <div className="typo-body font-semibold text-foreground">{a.name}</div>
                <div className="typo-caption" style={{ color: a.color }}>{a.tagline}</div>
              </div>
            </div>
            <div className="typo-caption text-foreground/85 line-clamp-2 min-h-[2.4em]">
              {preview.role}
            </div>
            <div className="typo-caption text-foreground mt-1.5 line-clamp-2 italic min-h-[2.4em]">
              “{preview.stance}”
            </div>
            <div className="flex items-center gap-3 mt-3">
              <DialMeter label={t.foundry.dial_risk} value={preview.risk} color={a.color} />
              <DialMeter label={t.foundry.dial_speed} value={preview.speed} color={a.color} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DialMeter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between typo-label uppercase tracking-wider text-foreground">
        <span>{label}</span>
        <span className="font-mono">{Math.round(value * 100)}</span>
      </div>
      <div className="h-1 rounded-full bg-secondary/80 mt-0.5 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.round(value * 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}
