/**
 * Analytics sink — the transport abstraction for usage events.
 *
 * The nav-tracking layer (`./index.ts`) emits structured events through the
 * *current* sink rather than calling Sentry directly. This is the seam that
 * keeps future backends pluggable without touching instrumentation:
 *
 *   - Option A (today): `sentrySink` — forwards to the existing Sentry path.
 *   - Option B (later):  a local-first SQLite sink (Tauri command upserts).
 *   - Option C (later):  a dedicated product-analytics sink (PostHog/Umami…).
 *
 * Swap the active sink with `setAnalyticsSink()`. Default is `sentrySink`.
 *
 * Privacy: events carry only section/tab/action *identifier strings* — never
 * user IDs, persona content, or credentials. The Sentry adapter additionally
 * runs every event through Sentry's `beforeSend` PII scrubber (see sentry.ts).
 */
import { trackFeature, trackInteraction, trackSessionSummary, trackConversion } from '../sentry';

/** A section or tab visit. */
export interface FeatureVisitEvent {
  /** SidebarSection identifier (e.g. "overview"). */
  section: string;
  /** Tab value within the section, if this is a tab switch. */
  tab?: string;
  /** "view" for a section landing, "tab_switch" for a tab change. */
  action: string;
}

/** A discrete, intentional interaction (button, wizard step, …). */
export interface InteractionEvent {
  category: string;
  action: string;
  label?: string;
}

/**
 * An activation-funnel conversion — a milestone reached for the FIRST time on
 * this install (`activation.ts` dedupes so each fires at most once). These are
 * the events a growth funnel (activation rate, time-to-value, K-factor) is
 * built from; nav/interaction events are too noisy for that.
 */
export interface ConversionEvent {
  /** Funnel step id, e.g. "persona_created" | "execution_completed" | "shared" | "imported". */
  step: string;
  /** 1-based position of this step in the activation funnel. */
  ordinal: number;
  /** Pseudonymous, opaque install id (random; not derived from anything personal). */
  installId: string;
}

/**
 * End-of-session rollup. Carries both what was visited (`counts`) and — the
 * point of the whole exercise — what was *never* visited (`sectionsIgnored`,
 * `tabsIgnored`), computed against the full catalog in `./summary.ts`.
 */
export interface SessionSummary {
  /** Per-key visit counts: bare section name, or `<dimKey>:<value>` for tabs. */
  counts: Record<string, number>;
  /** Sum of all counts. */
  totalVisits: number;
  sectionsVisited: string[];
  sectionsIgnored: string[];
  sectionsTotal: number;
  tabsVisited: string[];
  tabsIgnored: string[];
  tabsTotal: number;
}

export interface AnalyticsSink {
  feature(event: FeatureVisitEvent): void;
  interaction(event: InteractionEvent): void;
  session(summary: SessionSummary): void;
  conversion(event: ConversionEvent): void;
}

/** Default sink: forwards usage events to the existing Sentry pipeline. */
export const sentrySink: AnalyticsSink = {
  feature: (e) => trackFeature(e.section, e.tab, e.action),
  interaction: (e) => trackInteraction(e.category, e.action, e.label),
  session: (s) => trackSessionSummary(s),
  conversion: (e) => trackConversion(e.step, e.ordinal, e.installId),
};

/** Sink that discards everything — used when telemetry is off or in tests. */
export const noopSink: AnalyticsSink = {
  feature: () => {},
  interaction: () => {},
  session: () => {},
  conversion: () => {},
};

let current: AnalyticsSink = sentrySink;

/** The active sink. Instrumentation routes every event through this. */
export function getAnalyticsSink(): AnalyticsSink {
  return current;
}

/** Swap the active sink (e.g. to a local-first or product-analytics backend). */
export function setAnalyticsSink(sink: AnalyticsSink): void {
  current = sink;
}

/**
 * Point the active sink at a telemetry-preference change made mid-session.
 * Turning telemetry OFF routes usage events to `noopSink` so tracking stops
 * immediately — no restart needed; turning it back ON restores `sentrySink`.
 *
 * Scope: *usage analytics only*. Sentry error reporting and the navigation
 * subscription are established once at startup (`main.tsx`, gated on
 * `isTelemetryEnabled()`). So enabling telemetry that started OFF this session
 * still needs a restart before anything is reported — there is no live
 * subscription emitting events for the sink to receive.
 */
export function applyTelemetrySink(enabled: boolean): void {
  setAnalyticsSink(enabled ? sentrySink : noopSink);
}
