import type { Translations } from '@/i18n/en';

/**
 * Connector license tier classification.
 *
 * - personal:   Free-to-use tools with a generous or unlimited free plan
 * - paid:       Personal/team tools without a long-term free plan (trial only)
 * - enterprise: Tools primarily targeting large teams and enterprises
 */
export type LicenseTier = 'personal' | 'paid' | 'enterprise';

export interface LicenseTierMeta {
  /** i18n key inside `connector_licensing` — resolve via `resolveTierLabel()` or `t.connector_licensing[tier]`. */
  labelKey: string;
  /** Pre-resolved English label (kept for backward compatibility). */
  label: string;
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
}

export const LICENSE_TIER_META: Record<LicenseTier, LicenseTierMeta> = {
  personal: {
    labelKey: 'personal',
    label: 'Personal',
    color: '#22c55e',
    bgClass: 'bg-emerald-500/10',
    textClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/20',
  },
  paid: {
    labelKey: 'paid',
    label: 'Paid',
    color: '#f59e0b',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/20',
  },
  enterprise: {
    labelKey: 'enterprise',
    label: 'Enterprise',
    color: '#a855f7',
    bgClass: 'bg-purple-500/10',
    textClass: 'text-purple-400',
    borderClass: 'border-purple-500/20',
  },
};

/**
 * Resolve a license tier label using the active translation bundle.
 * Falls back to the English default when no bundle is provided.
 */
export function resolveTierLabel(tier: LicenseTier, t?: Translations): string {
  const section = t?.connector_licensing as Record<string, string> | undefined;
  return section?.[tier] ?? LICENSE_TIER_META[tier].label;
}

/**
 * Explicit license tier overrides per connector name.
 * Connectors not listed here fall back to metadata.pricing_tier mapping.
 */
const LICENSE_OVERRIDES: Record<string, LicenseTier> = {
  // -- Personal (free) ---------------------------------
  alpha_vantage:                   'personal',
  azure_devops:                    'personal',
  kubernetes:                      'personal',
  github:                          'personal',
  gitlab:                          'personal',
  github_actions:                  'personal',
  slack:                           'personal',
  discord:                         'personal',
  telegram:                        'personal',
  notion:                          'personal',
  airtable:                        'personal',
  clickup:                         'personal',
  linear:                          'personal',
  figma:                           'personal',
  vercel:                          'personal',
  netlify:                         'personal',
  cloudflare:                      'personal',
  supabase:                        'personal',
  neon:                            'personal',
  convex:                          'personal',
  upstash:                         'personal',
  sentry:                          'personal',
  circleci:                        'personal',
  sendgrid:                        'personal',
  resend:                          'personal',
  buffer:                          'personal',
  dropbox:                         'personal',
  posthog:                         'personal',
  postgres:                        'personal',
  mongodb:                         'personal',
  redis:                           'personal',
  duckdb:                          'personal',
  asana:                           'enterprise',
  google_workspace_oauth_template: 'personal',
  google_sheets:                   'personal',
  gmail:                           'personal',
  microsoft_outlook:               'personal',
  linkedin:                        'personal',
  reddit:                          'personal',
  mcp_gateway:                     'personal',
  arcade:                          'personal',
  n8n:                             'personal',
  microsoft_excel:                 'personal',
  microsoft_calendar:              'personal',
  microsoft_teams:                 'personal',
  onedrive:                        'personal',
  sharepoint:                      'personal',
  google_ads:                      'personal',
  google_calendar:                 'personal',
  canva:                           'personal',
  penpot:                          'personal',
  attio:                           'personal',
  crisp:                           'personal',
  woocommerce:                     'personal',
  lemonsqueezy:                    'personal',
  ramp:                            'personal',
  aws_s3:                          'personal',
  cloudflare_r2:                   'personal',
  backblaze_b2:                    'personal',
  tally:                           'personal',
  formbricks:                      'personal',
  novu:                            'personal',
  knock:                           'personal',
  ntfy:                            'personal',
  obsidian:                        'personal',

  elevenlabs:                      'personal',
  google_gemini:                   'personal',

  // -- Paid (no meaningful free tier) ------------------
  leonardo_ai:                     'paid',
  cal_com:                         'personal',
  calendly:                        'paid',
  pipedrive:                       'paid',
  monday:                          'paid',
  jira:                            'paid',
  confluence:                      'paid',
  mixpanel:                        'paid',
  twilio_sms:                      'paid',
  twilio_segment:                  'paid',
  betterstack:                     'paid',
  planetscale:                     'paid',
  zapier:                          'paid',

  // -- Enterprise --------------------------------------
  hubspot:                         'enterprise',
};

/**
 * Get the license tier for a connector.
 * Uses explicit overrides first, then falls back to metadata pricing_tier.
 */
export function getLicenseTier(
  connectorName: string,
  metadata?: Record<string, unknown> | null,
): LicenseTier {
  if (LICENSE_OVERRIDES[connectorName]) {
    return LICENSE_OVERRIDES[connectorName];
  }

  // Fall back to metadata.pricing_tier
  const pricing = metadata?.pricing_tier as string | undefined;
  switch (pricing) {
    case 'free':
    case 'freemium':
      return 'personal';
    case 'paid':
      return 'paid';
    case 'enterprise':
      return 'enterprise';
    default:
      return 'personal';
  }
}
