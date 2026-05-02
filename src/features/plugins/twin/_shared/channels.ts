/**
 * Single source of truth for twin channel metadata. Was duplicated across
 * 7 files (Tone × 3 variants, Channels × 3 variants, CreateTwinWizard) with
 * 5 divergent shapes — adding a new channel kind required touching all 7
 * in lockstep, and `serviceType` mismatches between Channels variants and
 * the wizard would silently break credential matching.
 *
 * Two role-specific lists:
 * - DEPLOYMENT_CHANNELS: platforms the twin can speak ON. Used by Channels
 *   variants + CreateTwinWizard. Each carries `serviceType` for credential
 *   matching against `credential.service_type`.
 * - TONE_CHANNELS: per-channel voice override slots. Includes 'generic'
 *   fallback + 'voice' (spoken word). No serviceType — tone is per-output,
 *   not per-credential.
 *
 * Visual fields are looked up via the `palette` key against `PALETTES`,
 * so consumers ask for colors symbolically (`PALETTES[meta.palette].dot`)
 * instead of hardcoding `bg-indigo-400` per file. All class strings are
 * literal so Tailwind's JIT can detect them.
 */

export type ChannelPalette = 'indigo' | 'cyan' | 'amber' | 'sky' | 'emerald' | 'violet' | 'green' | 'rose';

interface PaletteVisuals {
  dot: string;
  text: string;
  textBaseline: string;
  bg: string;
  tint: string;
}

export const PALETTES: Record<ChannelPalette, PaletteVisuals> = {
  indigo: { dot: 'bg-indigo-400', text: 'text-indigo-300', textBaseline: 'text-indigo-400', bg: 'bg-indigo-500/10', tint: 'from-indigo-500/30 to-violet-500/15' },
  cyan: { dot: 'bg-cyan-400', text: 'text-cyan-300', textBaseline: 'text-cyan-400', bg: 'bg-cyan-500/10', tint: 'from-cyan-500/30 to-sky-500/15' },
  amber: { dot: 'bg-amber-400', text: 'text-amber-300', textBaseline: 'text-amber-400', bg: 'bg-amber-500/10', tint: 'from-amber-500/30 to-orange-500/15' },
  sky: { dot: 'bg-sky-400', text: 'text-sky-300', textBaseline: 'text-sky-400', bg: 'bg-sky-500/10', tint: 'from-sky-500/30 to-blue-500/15' },
  emerald: { dot: 'bg-emerald-400', text: 'text-emerald-300', textBaseline: 'text-emerald-400', bg: 'bg-emerald-500/10', tint: 'from-emerald-500/30 to-teal-500/15' },
  violet: { dot: 'bg-violet-400', text: 'text-violet-300', textBaseline: 'text-violet-400', bg: 'bg-violet-500/10', tint: 'from-violet-500/30 to-fuchsia-500/15' },
  green: { dot: 'bg-green-400', text: 'text-green-300', textBaseline: 'text-green-400', bg: 'bg-green-500/10', tint: 'from-green-500/30 to-emerald-500/15' },
  rose: { dot: 'bg-rose-400', text: 'text-rose-300', textBaseline: 'text-rose-400', bg: 'bg-rose-500/10', tint: 'from-rose-500/30 to-pink-500/15' },
};

export interface ChannelMeta {
  id: string;
  /** Display label. Brand names ('Slack', 'Discord') are deliberately not
   *  translated — they're product names. Common nouns ('Email', 'SMS',
   *  'Voice', 'Generic') stay English here too because the channel ID is
   *  also the user-facing identifier in tone overrides; introducing
   *  per-locale labels would split the mental model from the data shape. */
  label: string;
  palette: ChannelPalette;
  /** Service-type substring matched against `credential.service_type`.
   *  Tone-only channels (generic/voice) omit this. */
  serviceType?: string;
}

export const DEPLOYMENT_CHANNELS: readonly ChannelMeta[] = [
  { id: 'discord', label: 'Discord', palette: 'indigo', serviceType: 'discord' },
  { id: 'slack', label: 'Slack', palette: 'cyan', serviceType: 'slack' },
  { id: 'email', label: 'Email', palette: 'amber', serviceType: 'gmail' },
  { id: 'telegram', label: 'Telegram', palette: 'sky', serviceType: 'telegram' },
  { id: 'sms', label: 'SMS', palette: 'emerald', serviceType: 'twilio-sms' },
  { id: 'teams', label: 'Teams', palette: 'violet', serviceType: 'microsoft-teams' },
  { id: 'whatsapp', label: 'WhatsApp', palette: 'green', serviceType: 'whatsapp' },
] as const;

export const TONE_CHANNELS: readonly ChannelMeta[] = [
  { id: 'generic', label: 'Generic', palette: 'violet' },
  { id: 'discord', label: 'Discord', palette: 'indigo' },
  { id: 'slack', label: 'Slack', palette: 'cyan' },
  { id: 'email', label: 'Email', palette: 'amber' },
  { id: 'sms', label: 'SMS', palette: 'emerald' },
  { id: 'voice', label: 'Voice', palette: 'rose' },
] as const;

const FOREGROUND_FALLBACK: PaletteVisuals = {
  dot: 'bg-foreground/20',
  text: 'text-foreground/65',
  textBaseline: 'text-foreground',
  bg: 'bg-secondary/40',
  tint: 'from-violet-500/15 to-fuchsia-500/10',
};

export function getDeploymentChannelMeta(id: string): ChannelMeta {
  return DEPLOYMENT_CHANNELS.find((c) => c.id === id) ?? { id, label: id, palette: 'violet', serviceType: id };
}

export function getToneChannelMeta(id: string): ChannelMeta {
  return TONE_CHANNELS.find((c) => c.id === id) ?? { id, label: id, palette: 'violet' };
}

/** Look up the palette visuals; falls back to a foreground-tinted set for
 *  unknown channel kinds (defensive against backend adding a kind the
 *  frontend doesn't know about yet). */
export function paletteOf(meta: ChannelMeta): PaletteVisuals {
  return PALETTES[meta.palette] ?? FOREGROUND_FALLBACK;
}
