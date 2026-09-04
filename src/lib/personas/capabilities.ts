import type { LucideIcon } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';
import { CONNECTOR_META } from '@/lib/connectors/connectorMeta';
import type { DesignUseCase, ModelProfile, UseCaseInputField } from '@/lib/types/frontendTypes';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import type { ResponsibilitySpec } from '@/lib/bindings/ResponsibilitySpec';
import type { Translations } from '@/i18n/generated/types';
import { interpolate } from '@/i18n/useTranslation';

export type CapabilityHealth = 'active' | 'disabled' | 'needs-attention';

/** Where a capability row came from. See {@link resolvePersonaCapabilities}. */
export type CapabilityOrigin = 'charter' | 'design-use-case';

/**
 * The ONE read-model every surface uses to answer "what can this persona do".
 *
 * Since the `e19_agent_manifest` migration a persona's capabilities are its
 * `persona_responsibilities` CHARTERS; `design_context.useCases` is the
 * pre-migration shape that only survives on personas the migration has not
 * touched (dry-run/build drafts that were never persisted, and any row created
 * by an older binary). Both project into this single shape so no consumer has
 * to branch — resolve through {@link resolvePersonaCapabilities}, never by
 * reading `design_context.useCases` directly.
 *
 * Renamed from `DisplayUseCase` (formerly
 * `agents/sub_use_cases/.../displayUseCase.ts`) when that module was retired.
 */
export interface PersonaCapability {
  id: string;
  title: string;
  description: string;
  category?: string;
  mode: 'e2e' | 'mock' | 'non_executable';
  health: CapabilityHealth;
  attentionReason?: string;
  hasModelOverride: boolean;
  /** The capability's own model override, normalised across origins: a charter
   *  stores a bare model id in `spec.modelOverride`, a legacy use case a full
   *  `ModelProfile` in `model_override`. `undefined` = inherit the persona's. */
  modelOverride?: ModelProfile;
  notificationChannels: string[];
  triggerLabel: string;
  /** Display label for the connector ("Slack", "GitHub"). */
  connector: string;
  /** CONNECTOR_META slug (lowercased) — drives the brand-icon render. `null`
   *  when no connector / tool hint resolves to a known connector. */
  connectorKey: string | null;
  /** Dimensions populated by this capability — drives the sigil petals. */
  dimensions: GlyphDimension[];
  origin: CapabilityOrigin;
  /** Present iff `origin === 'charter'`. */
  charter?: PersonaResponsibility;
  /** Present iff `origin === 'design-use-case'`. */
  raw?: DesignUseCase;
}

export type CapabilityHealthMeta = {
  label: string;
  toneText: string;
  toneBg: string;
  toneBorder: string;
  toneHex: string;
  icon: LucideIcon | null;
};

/** Factory — HEALTH_META with translated labels. Call where `t` is available. */
export function getHealthMeta(t: Translations): Record<CapabilityHealth, CapabilityHealthMeta> {
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

/** Factory — MODE_META with translated labels. */
export function getModeMeta(t: Translations): Record<PersonaCapability['mode'], { label: string; tone: string }> {
  return {
    e2e: { label: t.agents.use_cases.mode_e2e, tone: 'text-status-success border-status-success/25 bg-status-success/10' },
    mock: { label: t.agents.use_cases.mode_mock, tone: 'text-status-warning border-status-warning/25 bg-status-warning/10' },
    non_executable: { label: t.agents.use_cases.mode_info, tone: 'text-foreground border-border/40 bg-secondary/30' },
  };
}

/** Factory — DIM_LABELS with translated labels. */
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

export const STATE_HEX: Record<CapabilityHealth, string> = {
  active: '#34d399',
  'needs-attention': '#fbbf24',
  disabled: '#94a3b8',
};

// ---------------------------------------------------------------------------
// spec readers — `ResponsibilitySpec`'s loose fields are `serde_json::Value`
// ---------------------------------------------------------------------------

/** Narrow a `JsonValue` to a plain object. Every `spec.*` JsonValue field is
 *  DB-stored JSON, so its runtime shape is decided by whatever wrote the row —
 *  never by the binding. These readers are the only place that is assumed. */
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * The declared control-kind vocabulary, in ONE place. Both the narrowing below
 * and the parameter editor's control table key off this set, so a new kind is
 * added once rather than in a literal chain beside every renderer.
 */
export const CAPABILITY_FIELD_TYPES = ['text', 'number', 'select', 'boolean'] as const;
const FIELD_TYPE_SET: ReadonlySet<string> = new Set(CAPABILITY_FIELD_TYPES);

/** `spec.inputSchema` as the field list the parameter editor renders. Rows
 *  that are not `{key,label,type}`-shaped are dropped rather than trusted. */
export function specInputFields(spec: ResponsibilitySpec): UseCaseInputField[] {
  const out: UseCaseInputField[] = [];
  for (const row of asArray(spec.inputSchema)) {
    const o = asObject(row);
    const key = o?.key;
    if (typeof key !== 'string' || key.length === 0) continue;
    const rawType = o?.type;
    const type: UseCaseInputField['type'] =
      typeof rawType === 'string' && FIELD_TYPE_SET.has(rawType)
        ? (rawType as UseCaseInputField['type'])
        : 'text';
    out.push({
      key,
      type,
      label: typeof o?.label === 'string' ? o.label : key,
      default: o?.default,
      options: asArray(o?.options).filter((x): x is string => typeof x === 'string'),
    });
  }
  return out;
}

/** `spec.sampleInput` as the charter's saved parameter VALUES (see the tab's
 *  `charterParameters.ts` for why this column is the value store). */
export function specParameterValues(spec: ResponsibilitySpec): Record<string, unknown> {
  return asObject(spec.sampleInput) ?? {};
}

/** `spec.eventSubscriptions` flattened to display strings. */
export function specEventSubscriptions(spec: ResponsibilitySpec): string[] {
  return asArray(spec.eventSubscriptions)
    .map((row) => {
      if (typeof row === 'string') return row;
      const o = asObject(row);
      const name = o?.eventType ?? o?.event_type ?? o?.type ?? o?.name;
      return typeof name === 'string' ? name : null;
    })
    .filter((x): x is string => !!x);
}

/** Whether the charter's memory lane is on (`generationSettings` wins, then
 *  `memoryPolicy` — the same precedence `engine/prompt/capabilities.rs` uses). */
export function specMemoryEnabled(spec: ResponsibilitySpec): boolean {
  const gen = asObject(spec.generationSettings);
  if (typeof gen?.memories === 'string') return gen.memories === 'on';
  return asObject(spec.memoryPolicy)?.enabled === true;
}

/** The charter's review mode, or `null` when review is not configured. */
export function specReviewMode(spec: ResponsibilitySpec): string | null {
  const gen = asObject(spec.generationSettings);
  if (typeof gen?.reviews === 'string') return gen.reviews;
  const mode = asObject(spec.reviewPolicy)?.mode;
  return typeof mode === 'string' ? mode : null;
}

function reviewModeLights(mode: string | null): boolean {
  if (!mode) return false;
  const m = mode.toLowerCase();
  return m === 'on' || m === 'trust_llm' || m === 'always' || m === 'auto_triage' || m === 'autotriage' || m === 'auto-triage';
}

// ---------------------------------------------------------------------------
// connector matching (shared by both origins)
// ---------------------------------------------------------------------------

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

function connectorFromHints(hints: readonly string[], fallbackLabel: string): { connector: string; connectorKey: string | null } {
  for (const hint of hints) {
    const key = matchConnectorKey(hint);
    if (key) return { connectorKey: key, connector: CONNECTOR_META[key]!.label };
  }
  // Fall back to a category-ish label — not a real connector, but gives the
  // tile something to render. The icon component falls back to a generic plug.
  return { connectorKey: null, connector: fallbackLabel };
}

/** Slugs of connectors REFERENCED by a set of tool hints / connector ids. */
function referencedConnectors(ids: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const key = matchConnectorKey(id);
    if (key) out.add(key);
  }
  return out;
}

function prettyConnectorLabel(slug: string): string {
  return CONNECTOR_META[slug]?.label ?? slug
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

interface AttentionInfo {
  reason: string;
}

function deriveAttention(
  referenced: readonly string[],
  personaConnectors: ReadonlySet<string>,
): AttentionInfo | undefined {
  const used = referencedConnectors(referenced);
  const missing: string[] = [];
  for (const slug of used) if (!personaConnectors.has(slug)) missing.push(slug);
  if (missing.length === 0) return undefined;
  if (missing.length === 1) {
    // TODO(i18n): localize attention reason — needs t threaded through here
    return { reason: `${prettyConnectorLabel(missing[0]!)} isn't wired on this persona` };
  }
  // TODO(i18n): localize attention reason — needs t threaded through here
  return {
    reason: `${missing.length} required connectors aren't wired (${missing.map(prettyConnectorLabel).join(', ')})`,
  };
}

export interface CapabilityAdapterOptions {
  /** Persona's wired connector slugs (from `design_context.credentialLinks`).
   *  When provided, a capability whose connectors are not wired is flagged
   *  `needs-attention`. */
  personaConnectors?: ReadonlySet<string>;
  /** Explicit attention override — wins over the auto-derived one. */
  attention?: AttentionInfo;
}

// ---------------------------------------------------------------------------
// charter -> capability (the primary path since e19)
// ---------------------------------------------------------------------------

function charterTriggerLabel(r: PersonaResponsibility, t?: Translations): string {
  const c = r.cadence;
  if (c.attentionEnabled) {
    if (c.intervalMinutes) {
      return t
        ? interpolate(t.agents.responsibilities.trigger_every_minutes, { minutes: c.intervalMinutes })
        : `Every ${c.intervalMinutes} min`;
    }
    return t?.agents.responsibilities.trigger_attention ?? 'Attention loop';
  }
  return t?.agents.use_cases.trigger_manual ?? 'Manual';
}

function charterDimensions(r: PersonaResponsibility): GlyphDimension[] {
  const dims = new Set<GlyphDimension>();
  // Task is the universal "this charter does something" anchor.
  dims.add('task');
  if (r.cadence.attentionEnabled || r.spec.suggestedTrigger) dims.add('trigger');
  if (r.connectors.length > 0 || (r.spec.toolHints?.length ?? 0) > 0) dims.add('connector');
  if ((r.spec.notificationChannels?.length ?? 0) > 0) dims.add('message');
  if (specEventSubscriptions(r.spec).length > 0) dims.add('event');
  if (specMemoryEnabled(r.spec)) dims.add('memory');
  if (r.approvalGates.length > 0 || reviewModeLights(specReviewMode(r.spec))) dims.add('review');
  if (r.spec.errorPolicy || (r.spec.errorHandling ?? '').trim().length > 0) dims.add('error');
  return Array.from(dims);
}

/** `active` charters are live; every other status reads as paused. */
function charterHealth(r: PersonaResponsibility): CapabilityHealth {
  return r.status === 'active' ? 'active' : 'disabled';
}

/** Project one charter into the shared capability shape. Pure. */
export function capabilityFromCharter(
  r: PersonaResponsibility,
  options?: CapabilityAdapterOptions,
  t?: Translations,
): PersonaCapability {
  const referenced = [...r.connectors, ...(r.spec.toolHints ?? [])];
  const explicit = options?.attention;
  const derived =
    options?.personaConnectors && r.status === 'active'
      ? deriveAttention(referenced, options.personaConnectors)
      : undefined;
  const attention = explicit ?? derived;
  const { connector, connectorKey } = connectorFromHints(referenced, r.domain);
  return {
    id: r.id,
    title: r.title,
    description: r.procedure || r.outcomes[0]?.statement || '',
    category: r.domain,
    mode: r.spec.engineMode === 'mock' || r.spec.engineMode === 'non_executable' ? r.spec.engineMode : 'e2e',
    health: attention ? 'needs-attention' : charterHealth(r),
    attentionReason: attention?.reason,
    hasModelOverride: !!r.spec.modelOverride,
    modelOverride: r.spec.modelOverride ? { model: r.spec.modelOverride } : undefined,
    notificationChannels: r.spec.notificationChannels ?? [],
    triggerLabel: charterTriggerLabel(r, t),
    connector,
    connectorKey,
    dimensions: charterDimensions(r),
    origin: 'charter',
    charter: r,
  };
}

// ---------------------------------------------------------------------------
// design-context use case -> capability (pre-migration fallback)
// ---------------------------------------------------------------------------

function dimensionsForUseCase(uc: DesignUseCase): GlyphDimension[] {
  const dims = new Set<GlyphDimension>();
  dims.add('task');
  if (uc.suggested_trigger) dims.add('trigger');
  if ((uc.tool_hints?.length ?? 0) > 0) dims.add('connector');
  if ((uc.notification_channels?.length ?? 0) > 0) dims.add('message');
  if ((uc.event_subscriptions?.length ?? 0) > 0) dims.add('event');
  // Prefer the explicit v3 `generation_settings` envelope; recipe-ref shapes
  // carry only `review_policy` / `memory_policy`, mirroring the same fallback
  // the backend does in engine/prompt/capabilities.rs.
  const memories = uc.generation_settings?.memories;
  if (memories === 'on') dims.add('memory');
  else if (memories === undefined && uc.memory_policy?.enabled) dims.add('memory');

  const reviews = uc.generation_settings?.reviews;
  if (reviews === 'on' || reviews === 'trust_llm') dims.add('review');
  else if (reviews === undefined && reviewModeLights(uc.review_policy?.mode ?? null)) dims.add('review');
  return Array.from(dims);
}

function triggerLabelForUseCase(uc: DesignUseCase, t?: Translations): string {
  const tr = uc.suggested_trigger;
  if (!tr) return t?.agents.use_cases.trigger_manual ?? 'Manual';
  if (tr.cron) return tr.description ?? `Schedule: ${tr.cron}`;
  if (tr.description) return tr.description;
  return tr.type.charAt(0).toUpperCase() + tr.type.slice(1);
}

/** Project one legacy design-context use case into the shared shape. Pure. */
export function capabilityFromUseCase(uc: DesignUseCase, options?: CapabilityAdapterOptions): PersonaCapability {
  const hints = uc.tool_hints ?? [];
  const explicit = options?.attention;
  const derived =
    options?.personaConnectors && uc.enabled !== false
      ? deriveAttention(hints, options.personaConnectors)
      : undefined;
  const attention = explicit ?? derived;
  const { connector, connectorKey } = connectorFromHints(hints, uc.category ?? '');
  return {
    id: uc.id,
    title: uc.title,
    description: uc.capability_summary ?? uc.description,
    category: uc.category,
    mode: uc.execution_mode ?? 'e2e',
    health: attention ? 'needs-attention' : uc.enabled === false ? 'disabled' : 'active',
    attentionReason: attention?.reason,
    hasModelOverride: !!uc.model_override,
    modelOverride: uc.model_override,
    notificationChannels: (uc.notification_channels ?? []).filter((c) => c.enabled).map((c) => c.type),
    triggerLabel: triggerLabelForUseCase(uc),
    connector,
    connectorKey,
    dimensions: dimensionsForUseCase(uc),
    origin: 'design-use-case',
    raw: uc,
  };
}

export interface ResolveCapabilitiesInput extends CapabilityAdapterOptions {
  /** `persona_responsibilities` rows for the persona (post-e19 truth). */
  charters?: readonly PersonaResponsibility[] | null;
  /** `design_context.useCases` (pre-migration / dry-run fallback only). */
  useCases?: readonly DesignUseCase[] | null;
  /** Include non-`active` charters. Default `true` — the Responsibilities tab
   *  shows the whole status ladder; read-only consumers usually pass `false`. */
  includeInactiveCharters?: boolean;
  /** Localized labels for the derived trigger text. Optional. */
  t?: Translations;
}

/**
 * The one door: a persona's capability list, CHARTERS FIRST.
 *
 * INVARIANT AT THE FALLBACK: migration `e19_agent_manifest` minted one charter
 * per legacy `design_context` use case (idempotency key
 * `spec.migratedFromUseCaseId`), and `template_adopt` / `promote` stopped
 * writing `design_context.useCases` in the same change. So for any persona the
 * migration has run over, `charters` is complete and `useCases` is stale
 * residue — reading both would DOUBLE-COUNT every capability. `useCases` is
 * therefore consulted ONLY when the persona has no charters at all, which
 * today means exactly two situations: a build/dry-run draft that was never
 * persisted, and a row written by a binary older than e19. If that ever stops
 * being true, this function is the single place to fix it.
 */
export function resolvePersonaCapabilities(input: ResolveCapabilitiesInput): PersonaCapability[] {
  const { charters, useCases, includeInactiveCharters = true, t, ...adapterOptions } = input;
  const rows = (charters ?? []).filter((c) => includeInactiveCharters || c.status === 'active');
  if (rows.length > 0) {
    return rows.map((c) => capabilityFromCharter(c, adapterOptions, t));
  }
  return (useCases ?? []).map((u) => capabilityFromUseCase(u, adapterOptions));
}
