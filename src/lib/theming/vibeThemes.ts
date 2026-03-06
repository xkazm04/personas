/**
 * Persona Vibe Themes — maps agent personality to visual atmosphere.
 *
 * Each vibe defines CSS custom properties that overlay on top of the base
 * theme. They control accent glow, border tint, background warmth, and
 * animation rhythm without replacing the user's chosen colour theme.
 */

export type VibeId =
  | 'default'     // Neutral baseline — no overlay
  | 'clinical'    // Security, auditing, compliance — cold, monochrome, sharp
  | 'creative'    // Writing, art, brainstorming — warm, colorful, flowing
  | 'guardian'    // DevOps, infra, monitoring — green-tinted, steady
  | 'analytical'  // Data, finance, research — blue, precise, grid-like
  | 'energetic'   // Sales, marketing, social — vibrant, fast
  | 'stealth';    // Privacy, encryption, secret ops — near-invisible, muted

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
  /** Border opacity multiplier (0.5–1.5) */
  borderIntensity: number;
}

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
    glowColor: 'rgba(148, 163, 184, 0.12)',
    glowColorAlt: 'rgba(100, 116, 139, 0.08)',
    bgTint: 'rgba(148, 163, 184, 0.02)',
    animationScale: 0.7,
    borderIntensity: 1.3,
  },
  creative: {
    id: 'creative',
    label: 'Creative',
    glowColor: 'rgba(251, 191, 36, 0.12)',
    glowColorAlt: 'rgba(236, 72, 153, 0.08)',
    bgTint: 'rgba(251, 191, 36, 0.02)',
    animationScale: 1.3,
    borderIntensity: 0.8,
  },
  guardian: {
    id: 'guardian',
    label: 'Guardian',
    glowColor: 'rgba(52, 211, 153, 0.12)',
    glowColorAlt: 'rgba(6, 182, 212, 0.08)',
    bgTint: 'rgba(52, 211, 153, 0.02)',
    animationScale: 0.85,
    borderIntensity: 1.1,
  },
  analytical: {
    id: 'analytical',
    label: 'Analytical',
    glowColor: 'rgba(59, 130, 246, 0.12)',
    glowColorAlt: 'rgba(139, 92, 246, 0.08)',
    bgTint: 'rgba(59, 130, 246, 0.02)',
    animationScale: 0.9,
    borderIntensity: 1.2,
  },
  energetic: {
    id: 'energetic',
    label: 'Energetic',
    glowColor: 'rgba(244, 63, 94, 0.12)',
    glowColorAlt: 'rgba(249, 115, 22, 0.08)',
    bgTint: 'rgba(244, 63, 94, 0.02)',
    animationScale: 1.4,
    borderIntensity: 0.9,
  },
  stealth: {
    id: 'stealth',
    label: 'Stealth',
    glowColor: 'rgba(100, 116, 139, 0.06)',
    glowColorAlt: 'rgba(71, 85, 105, 0.04)',
    bgTint: 'rgba(15, 23, 42, 0.03)',
    animationScale: 0.6,
    borderIntensity: 0.5,
  },
};

// ---------------------------------------------------------------------------
// Keyword → Vibe mapping
// ---------------------------------------------------------------------------

/** Keywords that signal each vibe. Order matters — first match wins. */
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
