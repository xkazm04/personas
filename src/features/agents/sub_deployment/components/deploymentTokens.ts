export const DEPLOYMENT_TOKENS = {
  panelSpacing: 'space-y-4',
  cardRadius: 'rounded-modal',
  connectedBorder: 'border-status-success/20',
  connectedBg: 'bg-status-success/5',
  sectionHeadingGap: 'mb-3',
} as const;

/** Per-target deployment/signing accent identities. */
export type DeploymentAccent = 'cloud' | 'gitlab' | 'signed';

/**
 * Single source of truth for per-target accent hues across the deployment +
 * signing surface: cloud = indigo, GitLab = orange, signed artifacts = rose.
 *
 * Previously the *same* concept rendered with different hues depending on the
 * panel — "cloud" was indigo-400 (panel icon), blue-400 (summary card) and
 * indigo-500 (connect button) — which made one deployment read as two different
 * things. Route every per-target hue through this map so the whole surface stays
 * coherent and future theme work is a single edit.
 *
 * Values are full literal Tailwind class strings (never interpolated) so the
 * Tailwind scanner statically emits them.
 */
export const DEPLOYMENT_ACCENTS: Record<DeploymentAccent, {
  /** Icon / numeric-value text color. */
  text: string;
  /** Badge/chip: background + border + text together. */
  badge: string;
  /** Icon container: background + border (pairs with `text`). */
  iconContainer: string;
}> = {
  cloud: {
    text: 'text-role-agent',
    badge: 'bg-role-agent/10 border-role-agent/20 text-role-agent',
    iconContainer: 'bg-role-agent/10 border-role-agent/20',
  },
  gitlab: {
    text: 'text-status-warning',
    badge: 'bg-status-warning/10 border-status-warning/20 text-status-warning',
    iconContainer: 'bg-status-warning/10 border-status-warning/20',
  },
  signed: {
    text: 'text-status-error',
    badge: 'bg-status-error/10 border-status-error/20 text-status-error',
    iconContainer: 'bg-status-error/10 border-status-error/20',
  },
} as const;
