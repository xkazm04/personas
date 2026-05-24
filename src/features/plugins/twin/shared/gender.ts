/**
 * Single source of truth for gender → glyph/tint/color/pronouns mapping
 * shared by Profiles + Identity + the create-twin wizard. Five separate
 * inline copies existed before this module — three return shapes had
 * already drifted apart.
 */

export type Gender = 'male' | 'female' | 'neutral';

export interface GenderDef {
  id: Gender;
  /** Unicode sigil rendered in avatar tiles and gender selectors. */
  glyph: string;
  /** Tailwind gradient pair for `bg-gradient-to-br ${tint}` backgrounds. */
  tint: string;
  /** Single-class text color for compact baselines that don't gradient. */
  color: string;
  /** Suffix on `t.identity.*` for the human label. */
  labelKey: 'genderMale' | 'genderFemale' | 'genderNeutral';
}

export const GENDERS: readonly GenderDef[] = [
  { id: 'male', glyph: '♂', tint: 'from-sky-400/30 to-blue-400/30', color: 'text-sky-400/80', labelKey: 'genderMale' },
  { id: 'female', glyph: '♀', tint: 'from-rose-400/30 to-pink-400/30', color: 'text-rose-400/80', labelKey: 'genderFemale' },
  { id: 'neutral', glyph: '⚧', tint: 'from-violet-400/30 to-fuchsia-400/30', color: 'text-violet-400/70', labelKey: 'genderNeutral' },
] as const;

const NEUTRAL_DEF = GENDERS[2]!;

export function genderFromPronouns(pronouns: string | null): Gender {
  if (!pronouns) return 'neutral';
  const p = pronouns.toLowerCase();
  if (p.includes('he/') || p === 'male') return 'male';
  if (p.includes('she/') || p === 'female') return 'female';
  return 'neutral';
}

/** Round-trip helper. The pronouns column stores 'male' | 'female' | 'neutral' verbatim. */
export function pronounsFromGender(g: Gender): string {
  return g;
}

export function genderDef(g: Gender): GenderDef {
  return GENDERS.find((d) => d.id === g) ?? NEUTRAL_DEF;
}

export function genderDefFromPronouns(pronouns: string | null): GenderDef {
  return genderDef(genderFromPronouns(pronouns));
}
