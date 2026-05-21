import type { LucideIcon } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';
import { CONNECTOR_META } from '@/features/shared/components/display/ConnectorMeta';
import type { DesignUseCase } from '@/lib/types/frontendTypes';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { Translations } from '@/i18n/generated/types';

export type UseCaseHealth = 'active' | 'disabled' | 'needs-attention';

/** Visual contract consumed by SigilGrid + the shared MiniSigil / PersonaCrest
 *  / UseCaseDetailExpanded components. Thin facade over `DesignUseCase` plus
 *  derived fields the visuals need but the design data doesn't carry. */
export interface DisplayUseCase {
  id: string;
  title: string;
  description: string;
  category?: string;
  mode: 'e2e' | 'mock' | 'non_executable';
  health: UseCaseHealth;
  attentionReason?: string;
  hasModelOverride: boolean;
  notificationChannels: string[];
  triggerLabel: string;
  /** Display label for the connector ("Slack", "GitHub"). */
  connector: string;
  /** CONNECTOR_META slug (lowercased) — drives the brand-icon render. `null`
   *  when no tool hint resolves to a known connector. */
  connectorKey: string | null;
  /** Dimensions populated by this use case — drives the mini-sigil petals. */
  dimensions: GlyphDimension[];
  /** Backing DesignUseCase for components that need direct access (policy
   *  controls, history fetch by id, etc). */
  raw: DesignUseCase;
}

export type UseCaseHealthMeta = {
  label: string;
  toneText: string;
  toneBg: string;
  toneBorder: string;
  toneHex: string;
  icon: LucideIcon | null;
};

/** Factory — returns HEALTH_META with translated labels. Call in components
 *  where `t` is available (from `useTranslation()`). */
export function getHealthMeta(t: Translations): Record<UseCaseHealth, UseCaseHealthMeta> {
  return {
    active: {
      label: t.agents.use_cases.health_active,
      toneText: 'text-status-success',
      toneBg: 'bg-status-success/10',
      toneBorder: 'border-status-success/30',
      toneHex: '#34d399',
      icon: null,
    },
    disabled: {
      label: t.agents.use_cases.health_paused,
      toneText: 'text-foreground',
      toneBg: 'bg-secondary/30',
      toneBorder: 'border-border/40',
      toneHex: '#94a3b8',
      icon: null,
    },
    'needs-attention': {
      label: t.agents.use_cases.health_needs_attention,
      toneText: 'text-status-warning',
      toneBg: 'bg-status-warning/10',
      toneBorder: 'border-status-warning/40',
      toneHex: '#fbbf24',
      icon: AlertTriangle,
    },
  };
}

/** Factory — returns MODE_META with translated labels. Call in components
 *  where `t` is available. */
export function getModeMeta(t: Translations): Record<DisplayUseCase['mode'], { label: string; tone: string }> {
  return {
    e2e: { label: t.agents.use_cases.mode_e2e, tone: 'text-status-success border-status-success/25 bg-status-success/10' },
    mock: { label: t.agents.use_cases.mode_mock, tone: 'text-status-warning border-status-warning/25 bg-status-warning/10' },
    non_executable: { label: t.agents.use_cases.mode_info, tone: 'text-foreground border-border/40 bg-secondary/30' },
  };
}

/** Factory — returns DIM_LABELS with translated labels. Call in components
 *  where `t` is available. */
export function getDimLabels(t: Translations): Record<GlyphDimension, string> {
  return {
    trigger: t.agents.use_cases.dim_label_trigger,
    task: t.agents.use_cases.dim_label_task,
    connector: t.agents.use_cases.dim_label_connector,
    message: t.agents.use_cases.dim_label_message,
    review: t.agents.use_cases.dim_label_review,
    memory: t.agents.use_cases.dim_label_memory,
    event: t.agents.use_cases.dim_label_event,
    error: t.agents.use_cases.dim_label_error,
  };
}

/**
 * @deprecated Use `getHealthMeta(t)` factory instead. Kept for callers that
 * haven't migrated yet — labels will remain in English.
 */
export const HEALTH_META: Record<UseCaseHealth, UseCaseHealthMeta> = {
  active: {
    label: 'Active',
    toneText: 'text-status-success',
    toneBg: 'bg-status-success/10',
    toneBorder: 'border-status-success/30',
    toneHex: '#34d399',
    icon: null,
  },
  disabled: {
    label: 'Paused',
    toneText: 'text-foreground',
    toneBg: 'bg-secondary/30',
    toneBorder: 'border-border/40',
    toneHex: '#94a3b8',
    icon: null,
  },
  'needs-attention': {
    label: 'Needs attention',
    toneText: 'text-status-warning',
    toneBg: 'bg-status-warning/10',
    toneBorder: 'border-status-warning/40',
    toneHex: '#fbbf24',
    icon: AlertTriangle,
  },
};

/**
 * @deprecated Use `getModeMeta(t)` factory instead.
 */
export const MODE_META: Record<DisplayUseCase['mode'], { label: string; tone: string }> = {
  e2e: { label: 'E2E', tone: 'text-status-success border-status-success/25 bg-status-success/10' },
  mock: { label: 'MOCK', tone: 'text-status-warning border-status-warning/25 bg-status-warning/10' },
  non_executable: { label: 'INFO', tone: 'text-foreground border-border/40 bg-secondary/30' },
};

export const STATE_HEX: Record<UseCaseHealth, string> = {
  active: '#34d399',
  'needs-attention': '#fbbf24',
  disabled: '#94a3b8',
};

export const GRID_SLOT_COUNT = 9;

/** Greedy longest-prefix match of a tool-hint against CONNECTOR_META keys.
 *  Tool hints look like "slack_send_message" or "google_drive_list_files";
 *  longest-key-first ensures `google_drive` wins over `google`. */
function matchConnectorKey(toolHint: string): string | null {
  if (!toolHint) return null;
  const keys = Object.keys(CONNECTOR_META).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (toolHint === key || toolHint.startsWith(key + '_')) return key;
  }
  return null;
}

function deriveConnector(uc: DesignUseCase): { connector: string; connectorKey: string | null } {
  const hints = uc.tool_hints ?? [];
  for (const hint of hints) {
    const key = matchConnectorKey(hint);
    if (key) return { connectorKey: key, connector: CONNECTOR_META[key]!.label };
  }
  // Fall back to the use case category (e.g., "automation", "communication") —
  // not a real connector, but gives the tile *something* to render rather than
  // a blank corner. The icon component will gracefully fall back to the
  // generic Plug glyph.
  return { connectorKey: null, connector: uc.category ?? '' };
}

function deriveDimensions(uc: DesignUseCase): GlyphDimension[] {
  const dims = new Set<GlyphDimension>();
  // Task is the universal "this capability does *something*" anchor.
  dims.add('task');
  if (uc.suggested_trigger) dims.add('trigger');
  if ((uc.tool_hints?.length ?? 0) > 0) dims.add('connector');
  if ((uc.notification_channels?.length ?? 0) > 0) dims.add('message');
  if ((uc.event_subscriptions?.length ?? 0) > 0) dims.add('event');
  // Memory + review only when the explicit policy says yes — otherwise the
  // persona-level default applies but isn't render-time derivable.
  if (uc.generation_settings?.memories === 'on') dims.add('memory');
  const reviews = uc.generation_settings?.reviews;
  if (reviews === 'on' || reviews === 'trust_llm') dims.add('review');
  return Array.from(dims);
}

function deriveTriggerLabel(uc: DesignUseCase, t?: Translations): string {
  const tr = uc.suggested_trigger;
  if (!tr) return t?.agents.use_cases.trigger_manual ?? 'Manual';
  if (tr.cron) return tr.description ?? `Schedule: ${tr.cron}`;
  if (tr.description) return tr.description;
  return tr.type.charAt(0).toUpperCase() + tr.type.slice(1);
}

function deriveHealth(uc: DesignUseCase): UseCaseHealth {
  // Disabled is the design-time signal. `needs-attention` is layered in by
  // the caller (or auto-derived from `personaConnectors` below) — keeping
  // this function pure for `enabled` only.
  if (uc.enabled === false) return 'disabled';
  return 'active';
}

interface AttentionInfo {
  reason: string;
}

interface ToDisplayOptions {
  /** Persona's wired connector slugs (from `design_context.credentialLinks`).
   *  When provided, the adapter auto-derives attention if the use case's
   *  `tool_hints` reference connectors that aren't wired. The cheapest signal
   *  we can compute purely from design data — covers the common case of
   *  "user removed a credential and forgot they had a use case using it." */
  personaConnectors?: ReadonlySet<string>;
  /** Explicit attention override — wins over the auto-derived one. Use when
   *  a runtime signal (recent failure, expired token) wants to flag the use
   *  case independent of connector wiring. */
  attention?: AttentionInfo;
}

/** Slugs of connectors *referenced* by a use case's tool_hints. Greedy
 *  longest-prefix match against `CONNECTOR_META`, mirroring the recipe
 *  side's matcher so both sides agree on what "this hint uses Slack" means. */
function referencedConnectors(uc: DesignUseCase): Set<string> {
  const out = new Set<string>();
  const hints = uc.tool_hints ?? [];
  if (hints.length === 0) return out;
  const keys = Object.keys(CONNECTOR_META).sort((a, b) => b.length - a.length);
  for (const hint of hints) {
    for (const key of keys) {
      if (hint === key || hint.startsWith(key + '_')) {
        out.add(key);
        break;
      }
    }
  }
  return out;
}

function prettyConnectorLabel(slug: string): string {
  return CONNECTOR_META[slug]?.label ?? slug
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function deriveAttention(
  uc: DesignUseCase,
  personaConnectors: ReadonlySet<string>,
): AttentionInfo | undefined {
  if (uc.enabled === false) return undefined; // disabled wins; don't double-flag
  const used = referencedConnectors(uc);
  const missing: string[] = [];
  for (const slug of used) if (!personaConnectors.has(slug)) missing.push(slug);
  if (missing.length === 0) return undefined;
  if (missing.length === 1) {
    // TODO(i18n): localize attention reason — needs t threaded through toDisplayUseCase
    return { reason: `${prettyConnectorLabel(missing[0]!)} isn't wired on this persona` };
  }
  // TODO(i18n): localize attention reason — needs t threaded through toDisplayUseCase
  return {
    reason: `${missing.length} required connectors aren't wired (${missing.map(prettyConnectorLabel).join(', ')})`,
  };
}

/** Convert a real `DesignUseCase` to the visual `DisplayUseCase` consumed by
 *  SigilGrid. Pure. With `personaConnectors` provided, auto-derives the
 *  needs-attention state when tool_hints reference unwired connectors. */
export function toDisplayUseCase(uc: DesignUseCase, options?: ToDisplayOptions): DisplayUseCase {
  const explicitAttention = options?.attention;
  const derivedAttention = options?.personaConnectors
    ? deriveAttention(uc, options.personaConnectors)
    : undefined;
  const attention = explicitAttention ?? derivedAttention;

  const health: UseCaseHealth = attention ? 'needs-attention' : deriveHealth(uc);
  const { connector, connectorKey } = deriveConnector(uc);
  return {
    id: uc.id,
    title: uc.title,
    description: uc.capability_summary ?? uc.description,
    category: uc.category,
    mode: uc.execution_mode ?? 'e2e',
    health,
    attentionReason: attention?.reason,
    hasModelOverride: !!uc.model_override,
    notificationChannels: (uc.notification_channels ?? [])
      .filter((c) => c.enabled)
      .map((c) => c.type),
    triggerLabel: deriveTriggerLabel(uc),
    connector,
    connectorKey,
    dimensions: deriveDimensions(uc),
    raw: uc,
  };
}
