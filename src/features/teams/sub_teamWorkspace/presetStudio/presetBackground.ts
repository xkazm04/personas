import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';

/**
 * Per-team background illustrations for the preset gallery.
 *
 * Files dropped into `./assets/preset-bg/<presetId>.{webp,png,jpg}` are
 * auto-discovered at build time (no manual map to maintain) and resolved
 * to hashed asset URLs by Vite. They're generated uniquely per team via
 * the `/leonardo` skill. Any preset without an illustration falls back to
 * a tasteful gradient derived from its accent colour, so the gallery
 * always looks intentional even before art exists.
 */
const modules = import.meta.glob('./assets/preset-bg/*.{webp,png,jpg,jpeg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const IMAGES: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const file = path.split('/').pop();
  if (!file) continue;
  const id = file.replace(/\.(webp|png|jpe?g)$/i, '');
  IMAGES[id] = url;
}

/** Generated illustration URL for a preset id, or null to use the gradient. */
export function presetBackgroundImage(id: string): string | null {
  return IMAGES[id] ?? null;
}

/** Accent-derived diagonal gradient — the universal fallback / overlay base. */
export function presetGradient(color: string): string {
  return `linear-gradient(135deg, ${colorWithAlpha(color, 0.32)} 0%, ${colorWithAlpha(color, 0.08)} 52%, transparent 100%)`;
}

/** Legibility scrim laid over an illustration so overlaid text stays readable. */
export function presetScrim(): string {
  return 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.45) 42%, rgba(0,0,0,0.12) 100%)';
}
