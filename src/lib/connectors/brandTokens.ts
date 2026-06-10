// ---------------------------------------------------------------------------
// Per-connector brand-color token registry
// ---------------------------------------------------------------------------
//
// Single source of truth for the *brand* accent of each integration. Before
// this registry, connector surfaces coloured themselves ad hoc: GitLabPanel
// used `text-amber-400` for its header icon but `bg-orange-500` for the active
// tab underline — an icon-vs-underline mismatch that read like a bug. Other
// panels and cards each picked their own tint with no shared reference.
//
// Each entry derives from the service's *real* brand colour (the `hex` field is
// the provenance anchor; the Tailwind class fields are the hand-picked palette
// step that reads well on the app's dark surface). Connector panels, cards, and
// badges should read from here via `getBrandTokens(id)` instead of hardcoding
// inline colour classes, so the connector surface looks intentional and
// recognisable rather than randomly tinted.
//
// NOTE for Tailwind JIT: every class below is written as a literal string so it
// survives content-scan purging. Do not build these class names dynamically.
// ---------------------------------------------------------------------------

export interface BrandTokens {
  /**
   * The service's real brand colour as a hex string. This is the provenance
   * anchor the Tailwind class fields are chosen to approximate — it is not
   * itself a class. Useful for inline `style` (e.g. an SVG fill) where a
   * Tailwind utility doesn't fit.
   */
  hex: string;
  /** Icon glyph text colour, e.g. `text-orange-400`. */
  icon: string;
  /** Softer accent text colour for secondary brand text, e.g. `text-orange-300`. */
  accent: string;
  /** Tinted chip / badge / active-card background, e.g. `bg-orange-500/10`. */
  badgeBg: string;
  /** Border paired with `badgeBg` on chips / badges / cards, e.g. `border-orange-500/20`. */
  badgeBorder: string;
  /** Solid indicator bar — active tab underline, progress fill, e.g. `bg-orange-500`. */
  underline: string;
}

// Neutral fallback for any connector without a dedicated brand entry. Uses the
// theme `primary` token so it adapts per theme rather than locking to a hue.
const FALLBACK: BrandTokens = {
  hex: '#6366f1',
  icon: 'text-primary/80',
  accent: 'text-primary/70',
  badgeBg: 'bg-primary/10',
  badgeBorder: 'border-primary/20',
  underline: 'bg-primary',
};

/**
 * Brand tokens keyed by connector / plugin id. Keys cover the plugin ids the
 * Browse grid iterates (`dev-tools`, `obsidian-brain`, `drive`, `twin`,
 * `companion`, plus dev-only `artist`/`research-lab`/`fleet`), the
 * `gitlab` integration panel, and a handful of common service connectors whose
 * badges appear across the vault. Aliases (e.g. `obsidian` → obsidian-brain
 * tokens) keep lookups robust against id-vs-service_type drift.
 */
export const BRAND_TOKENS: Record<string, BrandTokens> = {
  // GitLab — brand orange (#FC6D26). The headline fix: icon AND underline now
  // share the orange family instead of amber-icon / orange-underline.
  gitlab: {
    hex: '#FC6D26',
    icon: 'text-orange-400',
    accent: 'text-orange-300',
    badgeBg: 'bg-orange-500/10',
    badgeBorder: 'border-orange-500/20',
    underline: 'bg-orange-500',
  },
  // GitHub — monochrome brand; a neutral slate reads as "source control,
  // not GitLab" without fighting the dark surface.
  github: {
    hex: '#8B949E',
    icon: 'text-slate-300',
    accent: 'text-slate-300',
    badgeBg: 'bg-slate-500/10',
    badgeBorder: 'border-slate-500/20',
    underline: 'bg-slate-400',
  },
  // Slack — aubergine brand (#4A154B) reads closest to purple on dark.
  slack: {
    hex: '#611F69',
    icon: 'text-purple-400',
    accent: 'text-purple-300',
    badgeBg: 'bg-purple-500/10',
    badgeBorder: 'border-purple-500/20',
    underline: 'bg-purple-500',
  },
  // Dev Tools plugin — amber.
  'dev-tools': {
    hex: '#F59E0B',
    icon: 'text-amber-400',
    accent: 'text-amber-300',
    badgeBg: 'bg-amber-500/10',
    badgeBorder: 'border-amber-500/20',
    underline: 'bg-amber-500',
  },
  // Obsidian Brain plugin — Obsidian's purple/violet brand.
  'obsidian-brain': {
    hex: '#7C3AED',
    icon: 'text-violet-400',
    accent: 'text-violet-300',
    badgeBg: 'bg-violet-500/10',
    badgeBorder: 'border-violet-500/20',
    underline: 'bg-violet-500',
  },
  // Google Drive plugin — Google blue, expressed as sky to match the existing
  // Drive surface treatment.
  drive: {
    hex: '#4285F4',
    icon: 'text-sky-400',
    accent: 'text-sky-300',
    badgeBg: 'bg-sky-500/10',
    badgeBorder: 'border-sky-500/20',
    underline: 'bg-sky-500',
  },
  // Twin plugin — violet (shares Obsidian's knowledge/identity family).
  twin: {
    hex: '#8B5CF6',
    icon: 'text-violet-400',
    accent: 'text-violet-300',
    badgeBg: 'bg-violet-500/10',
    badgeBorder: 'border-violet-500/20',
    underline: 'bg-violet-500',
  },
  // Companion plugin — cyan.
  companion: {
    hex: '#06B6D4',
    icon: 'text-cyan-400',
    accent: 'text-cyan-300',
    badgeBg: 'bg-cyan-500/10',
    badgeBorder: 'border-cyan-500/20',
    underline: 'bg-cyan-500',
  },
  // Artist plugin — fuchsia (creative).
  artist: {
    hex: '#D946EF',
    icon: 'text-fuchsia-400',
    accent: 'text-fuchsia-300',
    badgeBg: 'bg-fuchsia-500/10',
    badgeBorder: 'border-fuchsia-500/20',
    underline: 'bg-fuchsia-500',
  },
  // Research Lab plugin — purple (science).
  'research-lab': {
    hex: '#A855F7',
    icon: 'text-purple-400',
    accent: 'text-purple-300',
    badgeBg: 'bg-purple-500/10',
    badgeBorder: 'border-purple-500/20',
    underline: 'bg-purple-500',
  },
  // Fleet plugin — orange (distinct from dev-tools amber).
  fleet: {
    hex: '#F97316',
    icon: 'text-orange-400',
    accent: 'text-orange-300',
    badgeBg: 'bg-orange-500/10',
    badgeBorder: 'border-orange-500/20',
    underline: 'bg-orange-500',
  },
};

// Aliases — alternate ids/service_type strings that should resolve to an
// existing brand entry.
const ALIASES: Record<string, string> = {
  obsidian: 'obsidian-brain',
  desktop_obsidian: 'obsidian-brain',
  google_drive: 'drive',
};

/**
 * Resolve the brand tokens for a connector / plugin id. Falls back to a
 * theme-neutral `primary` palette for unknown ids so callers can always read
 * a complete token set without guarding for `undefined`.
 */
export function getBrandTokens(id: string | null | undefined): BrandTokens {
  if (!id) return FALLBACK;
  const direct = BRAND_TOKENS[id];
  if (direct) return direct;
  const aliased = ALIASES[id];
  if (aliased && BRAND_TOKENS[aliased]) return BRAND_TOKENS[aliased];
  return FALLBACK;
}

/** True when a dedicated (non-fallback) brand entry exists for the id. */
export function hasBrandTokens(id: string | null | undefined): boolean {
  if (!id) return false;
  return Boolean(BRAND_TOKENS[id] || (ALIASES[id] && BRAND_TOKENS[ALIASES[id]]));
}
