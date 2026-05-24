/**
 * Persona Vibe Themes -- maps agent personality to visual atmosphere.
 *
 * Each vibe defines CSS custom properties that overlay on top of the base
 * theme. They control accent glow, border tint, background warmth, and
 * animation rhythm without replacing the user's chosen colour theme.
 */

export type VibeId =
  | 'default'     // Neutral baseline -- no overlay
  | 'clinical'    // Security, auditing, compliance -- cold, monochrome, sharp
  | 'creative'    // Writing, art, brainstorming -- warm, colorful, flowing
  | 'guardian'    // DevOps, infra, monitoring -- green-tinted, steady
  | 'analytical'  // Data, finance, research -- blue, precise, grid-like
  | 'energetic'   // Sales, marketing, social -- vibrant, fast
  | 'stealth';    // Privacy, encryption, secret ops -- near-invisible, muted

export interface VibeTheme {
  id: VibeId;
  label: string;
  /** Glow/accent tint applied to borders and ambient light (CSS color) */
  glowColor: string;
  /** Secondary glow for gradient effects */
  glowColorAlt: string;
  /** Subtle background tint (very low opacity) */
  bgTint: string;
  /** Animation speed multiplier (1 = normal, <1 = calmer, >1 = livelier) */
  animationScale: number;
  /** Border opacity multiplier (0.5--1.5) */
  borderIntensity: number;
}

/**
 * Glow/tint colors are tokenized via color-mix() referencing
 * var(--primary) and var(--accent) so the orb always matches the
 * active app theme.  Each vibe controls intensity (%) and personality
 * (animation speed, border sharpness) — the hue comes from the theme.
 */
export const VIBE_THEMES: Record<VibeId, VibeTheme> = {
  default: {
    id: 'default',
    label: 'Default',
    glowColor: 'transparent',
    glowColorAlt: 'transparent',
    bgTint: 'transparent',
    animationScale: 1,
    borderIntensity: 1,
  },
  clinical: {
    id: 'clinical',
    label: 'Clinical',
    glowColor: 'color-mix(in srgb, var(--primary) 10%, transparent)',
    glowColorAlt: 'color-mix(in srgb, var(--accent) 6%, transparent)',
    bgTint: 'color-mix(in srgb, var(--primary) 2%, transparent)',
    animationScale: 0.7,
    borderIntensity: 1.3,
  },
  creative: {
    id: 'creative',
    label: 'Creative',
    glowColor: 'color-mix(in srgb, var(--accent) 12%, transparent)',
    glowColorAlt: 'color-mix(in srgb, var(--primary) 8%, transparent)',
    bgTint: 'color-mix(in srgb, var(--accent) 2%, transparent)',
    animationScale: 1.3,
    borderIntensity: 0.8,
  },
  guardian: {
    id: 'guardian',
    label: 'Guardian',
    glowColor: 'color-mix(in srgb, var(--primary) 12%, transparent)',
    glowColorAlt: 'color-mix(in srgb, var(--accent) 8%, transparent)',
    bgTint: 'color-mix(in srgb, var(--primary) 2%, transparent)',
    animationScale: 0.85,
    borderIntensity: 1.1,
  },
  analytical: {
    id: 'analytical',
    label: 'Analytical',
    glowColor: 'color-mix(in srgb, var(--primary) 12%, transparent)',
    glowColorAlt: 'color-mix(in srgb, var(--accent) 8%, transparent)',
    bgTint: 'color-mix(in srgb, var(--primary) 2%, transparent)',
    animationScale: 0.9,
    borderIntensity: 1.2,
  },
  energetic: {
    id: 'energetic',
    label: 'Energetic',
    glowColor: 'color-mix(in srgb, var(--accent) 14%, transparent)',
    glowColorAlt: 'color-mix(in srgb, var(--primary) 10%, transparent)',
    bgTint: 'color-mix(in srgb, var(--accent) 2%, transparent)',
    animationScale: 1.4,
    borderIntensity: 0.9,
  },
  stealth: {
    id: 'stealth',
    label: 'Stealth',
    glowColor: 'color-mix(in srgb, var(--primary) 5%, transparent)',
    glowColorAlt: 'color-mix(in srgb, var(--accent) 3%, transparent)',
    bgTint: 'color-mix(in srgb, var(--primary) 1%, transparent)',
    animationScale: 0.6,
    borderIntensity: 0.5,
  },
};

// ---------------------------------------------------------------------------
// Keyword -> Vibe mapping
// ---------------------------------------------------------------------------

/** Keywords that signal each vibe. Order matters -- first match wins. */
const VIBE_KEYWORDS: [VibeId, string[]][] = [
  ['clinical', [
    'security', 'audit', 'compliance', 'pentest', 'vulnerability', 'forensic',
    'soc', 'threat', 'incident', 'siem', 'hardening', 'firewall', 'scanner',
  ]],
  ['stealth', [
    'privacy', 'encrypt', 'stealth', 'covert', 'secret', 'classified',
    'anonymous', 'obfuscat', 'redact',
  ]],
  ['guardian', [
    'devops', 'infra', 'monitor', 'deploy', 'kubernetes', 'docker', 'ci/cd',
    'pipeline', 'sre', 'uptime', 'healthcheck', 'ops', 'terraform', 'ansible',
  ]],
  ['analytical', [
    'data', 'analy', 'research', 'finance', 'report', 'metric', 'statistic',
    'forecast', 'model', 'quantit', 'scientist', 'insight', 'sql', 'dashboard',
  ]],
  ['energetic', [
    'sales', 'market', 'social', 'outreach', 'campaign', 'growth', 'engage',
    'brand', 'influenc', 'content creator', 'viral', 'newsletter', 'pitch',
  ]],
  ['creative', [
    'writ', 'creat', 'art', 'design', 'story', 'brainstorm', 'poet',
    'fiction', 'blog', 'copywrite', 'narrative', 'imaginat', 'illustrat',
    'music', 'composit',
  ]],
];

/**
 * Derive a vibe from persona text fields.
 * Scans name, description, and system_prompt for keyword matches.
 */
export function deriveVibe(
  name: string | null | undefined,
  description: string | null | undefined,
  systemPrompt: string | null | undefined,
): VibeId {
  const haystack = [name, description, systemPrompt]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!haystack) return 'default';

  for (const [vibeId, keywords] of VIBE_KEYWORDS) {
    for (const kw of keywords) {
      if (haystack.includes(kw)) return vibeId;
    }
  }

  return 'default';
}
