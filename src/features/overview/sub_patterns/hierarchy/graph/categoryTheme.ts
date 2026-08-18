// The ONE theme authority for the 8 hierarchy categories — hue, glyph, and the
// derived SVG paint strings all come from this single table. The old graph's
// defect was a Tailwind twin file (`practiceAreaTheme.ts` ↔ `graphTheme.ts`)
// requiring lock-step edits; here there is no second file to drift.
//
// Color strategy: one raw hue per category (the Tailwind `*-400` stop, chosen
// for legibility on both themes), with the actual paints derived via
// `color-mix()` against the theme's own tokens — the stroke leans toward
// `--foreground` (darker in light theme, lighter in dark) and the deep fill
// leans toward `--background`, so both themes work from one table without a
// light-theme override anywhere.
import {
  Boxes,
  Layers,
  MonitorSmartphone,
  Plug,
  Server,
  ShieldCheck,
  Sparkles,
  Gauge,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface CategoryGraphTheme {
  /** Raw hue — node fills carry their own fillOpacity, so this stays vivid. */
  hue: string;
  /** Stroke paint: hue pulled toward the theme foreground for contrast. */
  stroke: string;
  /** Deep fill paint: hue pulled toward the theme background. */
  deep: string;
  icon: LucideIcon;
}

/** Small hue table — the 8 inventory categories from `categories.json`. */
const HUES: Record<string, { hue: string; icon: LucideIcon }> = {
  'ui-surfaces':          { hue: '#2dd4bf', icon: MonitorSmartphone },
  'client-architecture':  { hue: '#60a5fa', icon: Layers },
  'llm-agent':            { hue: '#a78bfa', icon: Sparkles },
  'backend-platform':     { hue: '#818cf8', icon: Server },
  operations:             { hue: '#38bdf8', icon: Gauge },
  security:               { hue: '#f87171', icon: ShieldCheck },
  integration:            { hue: '#fbbf24', icon: Plug },
  'engineering-process':  { hue: '#34d399', icon: Workflow },
};

const FALLBACK_HUE = { hue: '#94a3b8', icon: Boxes };

function derive({ hue, icon }: { hue: string; icon: LucideIcon }): CategoryGraphTheme {
  return {
    hue,
    stroke: `color-mix(in srgb, ${hue} 78%, var(--foreground) 22%)`,
    deep: `color-mix(in srgb, ${hue} 80%, var(--background) 20%)`,
    icon,
  };
}

const THEMES = new Map<string, CategoryGraphTheme>(
  Object.entries(HUES).map(([id, entry]) => [id, derive(entry)]),
);

const FALLBACK = derive(FALLBACK_HUE);

/** Theme for a category id (or ring key). Unknown / unassigned → neutral grey. */
export function categoryGraphTheme(categoryId: string | null): CategoryGraphTheme {
  return (categoryId !== null && THEMES.get(categoryId)) || FALLBACK;
}
