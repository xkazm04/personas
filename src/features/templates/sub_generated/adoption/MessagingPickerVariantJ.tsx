// @ts-nocheck — visual-review prototype (Variant J · "Quick Set").
// Simplifies Forge (H) without losing its aesthetic. Two ideas drive this
// variant:
//
//   1. Collapse the dual Time + Event trigger panels into ONE "When?"
//      preset segmented control. Typical users want "weekly mon 9am" or
//      "when X happens" — not to assemble both families by hand. An
//      "Edit…" flyout stays available for the hour / weekday / custom-
//      event edge cases, but it is no longer the default surface.
//
//   2. Replace per-event destination chips with a UC-level "Deliver to"
//      row. One row controls every event at once. Each event row still
//      shows its bespoke Forge stamp + description so the user reads what
//      will fire — they just don't configure routing per row unless they
//      opt in via the "Customize per event" toggle.
//
// Net result: full setup (enable → when → destinations) is three clicks
// for the common path, and the Forge-level control surface is still one
// click away when needed.
//
// Token rules (feedback_tailwind_brand_tokens): primary = cyan accent,
// status-warning = amber, status-info = blue, status-error = red.

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  Inbox,
  Info,
  Loader2,
  Play,
  Plus,
  Settings2,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  DEV_CLONE_FIXTURE_USE_CASES,
  FALLBACK_SAMPLE,
  MOCK_EMIT_EVENTS_BY_UC,
  SAMPLE_MESSAGE_BY_UC,
  mockTestDelivery,
} from './MessagingPickerShared';
import {
  TIME_PRESETS,
  WEEKDAYS,
  clampHour,
  disableEventFamily,
  disableTimeFamily,
  enableEventFamily,
  enableTimeFamily,
  hasEvent,
  hasTime,
  selectionForTimePreset,
  updateEvent,
  updateTime,
  type TriggerSelection,
} from './useCasePickerShared';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import {
  getConnectorMeta,
  ConnectorIcon,
  type ConnectorMeta,
} from '@/features/shared/components/display/ConnectorMeta';
import { useVaultStore } from '@/stores/vaultStore';
import { QuickAddCredentialModal } from './QuickAddCredentialModal';
import { BaseModal } from '@/lib/ui/BaseModal';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { listAllSubscriptions } from '@/api/overview/events';

const UC_SUBTITLE: Record<string, string> = {
  uc_signals:            'Composes buy / sell / hold signals from RSI, MACD, and earnings data',
  uc_congressional_scan: 'Matches congressional stock disclosures against watched sectors',
  uc_gems:               'Surfaces under-covered names passing technical + catalyst thresholds',
};

const UC_DESCRIPTION: Record<string, string> = {
  uc_signals:
    "Scores each ticker's technical stack (RSI, MACD), earnings, and sector rotation into a composite and emits stocks.signals.{buy,sell,hold}.",
  uc_congressional_scan:
    "Pulls weekly congressional disclosures and cross-checks them against watched sectors.",
  uc_gems:
    "Discovers under-covered names passing a configurable tech-score and catalyst filter.",
};

const COMMON_PERSONA_EVENTS = [
  'system.persona.started',
  'system.persona.completed',
  'system.execution.succeeded',
  'system.execution.failed',
  'scheduler.tick.hourly',
  'scheduler.tick.daily',
];

const MESSAGING_SERVICE_TYPES = [
  'personas_messages',
  'slack',
  'discord',
  'telegram',
  'microsoft_teams',
];

const MESSAGING_CATEGORY = 'messaging';
const APP_NOTIF: DestId = 'app_notif';
const IN_APP: DestId = 'in_app';

type DestId = 'app_notif' | 'in_app' | string;

interface Destination {
  id: DestId;
  label: string;
  shortLabel: string;
  kind: 'default' | 'channel';
  icon?: LucideIcon;
  meta?: ConnectorMeta;
}

const FADE = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };
const HEIGHT_FADE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit:    { height: 0, opacity: 0 },
  transition: { duration: 0.22, ease: FADE.ease },
};

// ─── "When?" presets ─────────────────────────────────────────────────────
// The five presets that cover ~95% of real configurations. The sixth
// slot is "Custom" — opens the Forge-style Time + Event editor when the
// user needs something not in the preset grid.
type WhenPresetId = 'hourly' | 'daily_9' | 'weekly_mon' | 'weekly_fri' | 'on_event' | 'manual';

interface WhenPreset {
  id: WhenPresetId;
  label: string;
  sub: string;
  icon: LucideIcon;
  toSelection: (prev: TriggerSelection, availableEvents: string[]) => TriggerSelection;
}

const WHEN_PRESETS: WhenPreset[] = [
  {
    id: 'hourly',
    label: 'Every hour',
    sub: 'cron 0 * * * *',
    icon: Clock,
    toSelection: () => selectionForTimePreset('hourly', {}),
  },
  {
    id: 'daily_9',
    label: 'Daily · 9 am',
    sub: 'weekdays + weekends',
    icon: Calendar,
    toSelection: () => ({ time: { preset: 'daily', hourOfDay: 9 } }),
  },
  {
    id: 'weekly_mon',
    label: 'Weekly · Mon',
    sub: 'Monday 9 am',
    icon: Calendar,
    toSelection: () => ({ time: { preset: 'weekly', weekday: 1, hourOfDay: 9 } }),
  },
  {
    id: 'weekly_fri',
    label: 'Weekly · Fri',
    sub: 'Friday 5 pm',
    icon: Calendar,
    toSelection: () => ({ time: { preset: 'weekly', weekday: 5, hourOfDay: 17 } }),
  },
  {
    id: 'on_event',
    label: 'On event',
    sub: 'fires when X happens',
    icon: Zap,
    toSelection: (_prev, available) => ({ event: { eventType: available[0] ?? '' } }),
  },
  {
    id: 'manual',
    label: 'Manual',
    sub: 'run by hand only',
    icon: Play,
    toSelection: () => ({}),
  },
];

// Classify a TriggerSelection back to the closest preset so the segmented
// control can show the correct active pill even when the selection was
// created in the Custom editor.
function classifyWhen(sel: TriggerSelection): WhenPresetId | null {
  if (sel.event && !sel.time) return 'on_event';
  if (!sel.time && !sel.event) return 'manual';
  if (sel.time?.preset === 'hourly') return 'hourly';
  if (sel.time?.preset === 'daily' && sel.time?.hourOfDay === 9) return 'daily_9';
  if (sel.time?.preset === 'weekly' && sel.time?.weekday === 1 && sel.time?.hourOfDay === 9) return 'weekly_mon';
  if (sel.time?.preset === 'weekly' && sel.time?.weekday === 5 && sel.time?.hourOfDay === 17) return 'weekly_fri';
  return null; // custom
}

export function MessagingPickerVariantJ() {
  const useCases = DEV_CLONE_FIXTURE_USE_CASES;

  const vaultCredentials = useVaultStore((s) => s.credentials);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);

  useEffect(() => {
    fetchCredentials().catch(() => { /* prototype */ });
  }, [fetchCredentials]);

  const [subscribedEventTypes, setSubscribedEventTypes] = useState<string[]>([]);
  useEffect(() => {
    listAllSubscriptions()
      .then((subs) => {
        const types = new Set<string>();
        for (const s of subs) types.add(s.event_type);
        setSubscribedEventTypes(Array.from(types));
      })
      .catch(() => { /* prototype */ });
  }, []);

  const availableEventKeys = useMemo(() => {
    const out = new Set<string>();
    for (const uc of useCases) {
      for (const ev of MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? []) out.add(ev.event_type);
    }
    for (const t of subscribedEventTypes) out.add(t);
    for (const t of COMMON_PERSONA_EVENTS) out.add(t);
    return Array.from(out).sort();
  }, [useCases, subscribedEventTypes]);

  const eventOptions: ThemedSelectOption[] = useMemo(
    () => availableEventKeys.map((e) => ({ value: e, label: e })),
    [availableEventKeys],
  );

  const attachableChannels = useMemo(
    () =>
      vaultCredentials
        .filter(
          (c) =>
            MESSAGING_SERVICE_TYPES.includes(c.service_type) &&
            c.service_type !== 'personas_messages' &&
            c.healthcheck_last_success === true,
        )
        .map((c) => ({ id: c.id, service_type: c.service_type, name: c.name })),
    [vaultCredentials],
  );

  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(useCases.map((u) => u.id)));
  const [triggerByUc, setTriggerByUc] = useState<Record<string, TriggerSelection>>(() =>
    Object.fromEntries(useCases.map((u) => [u.id, { time: { preset: 'weekly', weekday: 1, hourOfDay: 9 } }])),
  );
  const [attachedChannels, setAttachedChannels] = useState<Set<string>>(() => new Set());

  // Unified routing: UC → Set<DestId>. Applied to every emitted event on
  // the UC. When a user opens the "customize per event" drawer, the
  // unified set seeds the per-event routes and the UC switches modes.
  const [unifiedRoutes, setUnifiedRoutes] = useState<Record<string, Set<DestId>>>(() => {
    const out: Record<string, Set<DestId>> = {};
    for (const uc of useCases) out[uc.id] = new Set<DestId>([IN_APP, APP_NOTIF]);
    return out;
  });

  // Per-event routing (only populated when user enters customize mode).
  const [customRoutes, setCustomRoutes] = useState<Record<string, Record<string, Set<DestId>>>>({});
  const [customized, setCustomized] = useState<Set<string>>(() => new Set());

  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'running' | 'done'>>({});
  const [previewReady, setPreviewReady] = useState<Record<string, boolean>>({});
  const [previewUcId, setPreviewUcId] = useState<string | null>(null);
  const [expandedDesc, setExpandedDesc] = useState<Set<string>>(() => new Set());
  const [customEditorOpen, setCustomEditorOpen] = useState<Set<string>>(() => new Set());
  const [quickAddCtx, setQuickAddCtx] = useState<{ ucId: string } | null>(null);

  function toggleEnabled(ucId: string) {
    setEnabled((prev) => {
      const n = new Set(prev);
      n.has(ucId) ? n.delete(ucId) : n.add(ucId);
      return n;
    });
  }

  function toggleDesc(ucId: string) {
    setExpandedDesc((prev) => {
      const n = new Set(prev);
      n.has(ucId) ? n.delete(ucId) : n.add(ucId);
      return n;
    });
  }

  function toggleCustomEditor(ucId: string) {
    setCustomEditorOpen((prev) => {
      const n = new Set(prev);
      n.has(ucId) ? n.delete(ucId) : n.add(ucId);
      return n;
    });
  }

  function setTriggerSelection(ucId: string, sel: TriggerSelection) {
    setTriggerByUc((prev) => ({ ...prev, [ucId]: sel }));
  }

  function toggleUnifiedRoute(ucId: string, destId: DestId) {
    setUnifiedRoutes((prev) => {
      const s = new Set(prev[ucId] ?? []);
      s.has(destId) ? s.delete(destId) : s.add(destId);
      return { ...prev, [ucId]: s };
    });
  }

  function togglePerEventRoute(ucId: string, eventType: string, destId: DestId) {
    setCustomRoutes((prev) => {
      const ucMap = { ...(prev[ucId] ?? {}) };
      const s = new Set(ucMap[eventType] ?? []);
      s.has(destId) ? s.delete(destId) : s.add(destId);
      ucMap[eventType] = s;
      return { ...prev, [ucId]: ucMap };
    });
  }

  function enterCustomMode(ucId: string) {
    setCustomized((prev) => {
      const n = new Set(prev);
      n.add(ucId);
      return n;
    });
    // Seed per-event routes from the unified set so no information is lost.
    setCustomRoutes((prev) => {
      if (prev[ucId]) return prev; // already seeded
      const seed: Record<string, Set<DestId>> = {};
      const unified = unifiedRoutes[ucId] ?? new Set<DestId>();
      for (const ev of MOCK_EMIT_EVENTS_BY_UC[ucId] ?? []) {
        seed[ev.event_type] = new Set(unified);
      }
      return { ...prev, [ucId]: seed };
    });
  }

  function exitCustomMode(ucId: string) {
    setCustomized((prev) => {
      const n = new Set(prev);
      n.delete(ucId);
      return n;
    });
    // Collapse per-event routes back into a union → unifiedRoutes so the
    // simple view keeps the user's choices. Destructive for "some events
    // had different destinations", but we intentionally normalise.
    setCustomRoutes((prev) => {
      const ucMap = prev[ucId] ?? {};
      const union = new Set<DestId>();
      for (const s of Object.values(ucMap)) for (const d of s) union.add(d);
      setUnifiedRoutes((u) => ({ ...u, [ucId]: union }));
      const { [ucId]: _drop, ...rest } = prev;
      return rest;
    });
  }

  function attachChannelAndRoute(chId: string, ucId: string) {
    setAttachedChannels((prev) => {
      const n = new Set(prev);
      n.add(chId);
      return n;
    });
    if (customized.has(ucId)) {
      setCustomRoutes((prev) => {
        const ucMap = { ...(prev[ucId] ?? {}) };
        for (const ev of MOCK_EMIT_EVENTS_BY_UC[ucId] ?? []) {
          const s = new Set(ucMap[ev.event_type] ?? []);
          s.add(chId);
          ucMap[ev.event_type] = s;
        }
        return { ...prev, [ucId]: ucMap };
      });
    } else {
      setUnifiedRoutes((prev) => {
        const s = new Set(prev[ucId] ?? []);
        s.add(chId);
        return { ...prev, [ucId]: s };
      });
    }
  }

  function removeChannel(chId: string) {
    setAttachedChannels((prev) => {
      const n = new Set(prev);
      n.delete(chId);
      return n;
    });
    setUnifiedRoutes((prev) => {
      const next: typeof prev = {};
      for (const k of Object.keys(prev)) {
        const s = new Set(prev[k]);
        s.delete(chId);
        next[k] = s;
      }
      return next;
    });
    setCustomRoutes((prev) => {
      const next: typeof prev = {};
      for (const ucId of Object.keys(prev)) {
        const ucMap: Record<string, Set<DestId>> = {};
        for (const et of Object.keys(prev[ucId])) {
          const s = new Set(prev[ucId][et]);
          s.delete(chId);
          ucMap[et] = s;
        }
        next[ucId] = ucMap;
      }
      return next;
    });
  }

  const destinations = useMemo<Destination[]>(() => {
    const out: Destination[] = [
      { id: APP_NOTIF, label: 'App notification', shortLabel: 'App',    kind: 'default', icon: Bell },
      { id: IN_APP,    label: 'In-App Message',    shortLabel: 'In-App', kind: 'default', icon: Inbox },
    ];
    for (const chId of attachedChannels) {
      const ch = attachableChannels.find((c) => c.id === chId);
      if (!ch) continue;
      const meta = getConnectorMeta(ch.service_type);
      out.push({
        id: ch.id,
        label: `${meta.label} · ${ch.name}`,
        shortLabel: meta.label,
        kind: 'channel',
        meta,
      });
    }
    return out;
  }, [attachedChannels, attachableChannels]);

  async function runTest(ucId: string) {
    setTestStatus((prev) => ({ ...prev, [ucId]: 'running' }));
    const union = new Set<DestId>();
    if (customized.has(ucId)) {
      const map = customRoutes[ucId] ?? {};
      for (const s of Object.values(map)) for (const d of s) union.add(d);
    } else {
      for (const d of unifiedRoutes[ucId] ?? new Set()) union.add(d);
    }
    const sample = SAMPLE_MESSAGE_BY_UC[ucId] ?? FALLBACK_SAMPLE;
    await mockTestDelivery(Array.from(union), sample);
    setTestStatus((prev) => ({ ...prev, [ucId]: 'done' }));
    if (union.has(IN_APP)) setPreviewReady((prev) => ({ ...prev, [ucId]: true }));
    setTimeout(() => {
      setTestStatus((prev) => ({ ...prev, [ucId]: 'idle' }));
    }, 2200);
  }

  const previewSample = previewUcId ? SAMPLE_MESSAGE_BY_UC[previewUcId] ?? FALLBACK_SAMPLE : null;
  const previewUc = previewUcId ? useCases.find((u) => u.id === previewUcId) : null;

  return (
    <>
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {useCases.map((uc) => {
            const on = enabled.has(uc.id);
            const trigger = triggerByUc[uc.id] ?? {};
            const unified = unifiedRoutes[uc.id] ?? new Set<DestId>();
            const emits = MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? [];
            const subtitle = UC_SUBTITLE[uc.id] ?? 'User-defined capability';
            const description = UC_DESCRIPTION[uc.id] ?? subtitle;
            const status = testStatus[uc.id] ?? 'idle';
            const firing = status === 'running';
            const canPreview = Boolean(previewReady[uc.id]);
            const descExpanded = expandedDesc.has(uc.id);
            const editorOpen = customEditorOpen.has(uc.id);
            const isCustomized = customized.has(uc.id);
            const activePreset = classifyWhen(trigger);

            return (
              <motion.div
                key={uc.id}
                layout
                transition={{ duration: 0.25, ease: FADE.ease }}
                className={`rounded-card overflow-hidden transition-colors ${
                  on
                    ? 'ring-1 ring-primary/50 bg-primary/[0.04] shadow-elevation-2'
                    : 'ring-1 ring-border/70 bg-foreground/[0.015]'
                }`}
              >
                {/* Header — Forge parity */}
                <div className="flex items-start gap-4 px-5 py-4 border-b border-border/60">
                  <button
                    type="button"
                    onClick={() => toggleEnabled(uc.id)}
                    aria-pressed={on}
                    className={`focus-ring flex-shrink-0 mt-1.5 w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                      on
                        ? 'bg-primary ring-1 ring-primary shadow-elevation-1'
                        : 'bg-transparent ring-1 ring-foreground/25 hover:ring-foreground/40'
                    }`}
                  >
                    {on && <Check className="w-4 h-4 text-background" strokeWidth={3} />}
                  </button>
                  <h4
                    className={`flex-1 min-w-0 text-3xl font-semibold leading-tight tracking-tight truncate ${
                      on ? 'text-foreground' : 'text-foreground/70'
                    }`}
                  >
                    {uc.name}
                  </h4>
                  {on && (
                    <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
                      <button
                        type="button"
                        onClick={() => toggleDesc(uc.id)}
                        aria-pressed={descExpanded}
                        className={`focus-ring w-10 h-10 rounded-full ring-1 flex items-center justify-center transition-colors ${
                          descExpanded
                            ? 'ring-primary/60 bg-primary/15 text-primary'
                            : 'ring-border bg-secondary/40 text-foreground/80 hover:bg-secondary/70 hover:text-foreground'
                        }`}
                      >
                        <Info className="w-5 h-5" />
                      </button>
                      <AnimatePresence initial={false}>
                        {canPreview && (
                          <motion.button
                            key="preview"
                            type="button"
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={FADE}
                            onClick={() => setPreviewUcId(uc.id)}
                            className="focus-ring w-10 h-10 rounded-full ring-1 ring-border bg-secondary/40 text-foreground/80 hover:bg-secondary/70 hover:text-foreground flex items-center justify-center transition-colors"
                          >
                            <Eye className="w-5 h-5" />
                          </motion.button>
                        )}
                      </AnimatePresence>
                      <button
                        type="button"
                        onClick={() => runTest(uc.id)}
                        disabled={status === 'running'}
                        className="focus-ring w-10 h-10 rounded-full ring-1 ring-primary/60 bg-primary/20 text-primary hover:bg-primary/30 hover:ring-primary/70 disabled:opacity-60 flex items-center justify-center shadow-elevation-1 transition-all"
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={status}
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.7 }}
                            transition={{ duration: 0.14 }}
                            className="inline-flex"
                          >
                            {status === 'running' ? (
                              <Loader2 className="w-5 h-5 animate-spin" />
                            ) : status === 'done' ? (
                              <CheckCircle2 className="w-5 h-5 text-status-success" />
                            ) : (
                              <Play className="w-5 h-5" />
                            )}
                          </motion.span>
                        </AnimatePresence>
                      </button>
                    </div>
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {on && descExpanded && (
                    <motion.div key="desc" {...HEIGHT_FADE} className="overflow-hidden">
                      <div className="px-5 py-3.5 bg-foreground/[0.02] border-b border-border/50">
                        <p className="typo-body-lg text-foreground/80 leading-relaxed">{description}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div key="body" {...HEIGHT_FADE} className="overflow-hidden">
                      <div
                        className="relative px-5 py-5 bg-gradient-to-b from-foreground/[0.015] to-foreground/[0.04] space-y-4"
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(90deg, transparent 0 19px, color-mix(in srgb, var(--color-foreground) 3%, transparent) 19px 20px)',
                        }}
                      >
                        {/* STEP 1 — "When?" preset selector */}
                        <section className="rounded-card ring-1 ring-border/80 bg-background/75 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="inline-flex items-center gap-2 typo-caption uppercase tracking-[0.2em] text-primary font-semibold">
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold tabular-nums">1</span>
                              When?
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleCustomEditor(uc.id)}
                              className={`focus-ring inline-flex items-center gap-1 px-2 py-0.5 rounded typo-caption font-medium transition-colors ${
                                editorOpen
                                  ? 'bg-primary/15 text-primary ring-1 ring-primary/40'
                                  : 'text-foreground/60 hover:text-foreground hover:bg-foreground/[0.05]'
                              }`}
                            >
                              <Settings2 className="w-3.5 h-3.5" />
                              {activePreset === null ? 'Custom' : 'Edit…'}
                              <ChevronDown className={`w-3 h-3 transition-transform ${editorOpen ? 'rotate-180' : ''}`} />
                            </button>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            {WHEN_PRESETS.map((preset) => {
                              const Icon = preset.icon;
                              const isActive = activePreset === preset.id;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() =>
                                    setTriggerSelection(uc.id, preset.toSelection(trigger, availableEventKeys))
                                  }
                                  className={`focus-ring group relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg ring-1 transition-all text-left ${
                                    isActive
                                      ? 'ring-primary/60 bg-primary/10 shadow-elevation-1'
                                      : 'ring-border bg-background hover:ring-foreground/30 hover:bg-foreground/[0.02]'
                                  }`}
                                >
                                  <span
                                    className={`flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full ring-1 transition-colors ${
                                      isActive
                                        ? 'ring-primary/60 bg-primary/15 text-primary'
                                        : 'ring-border bg-foreground/[0.03] text-foreground/55 group-hover:text-foreground'
                                    }`}
                                  >
                                    <Icon className="w-4 h-4" />
                                  </span>
                                  <span className="flex flex-col min-w-0">
                                    <span className={`typo-body font-semibold truncate ${isActive ? 'text-foreground' : 'text-foreground/85'}`}>
                                      {preset.label}
                                    </span>
                                    <span className="typo-caption font-mono text-foreground/50 truncate">
                                      {preset.sub}
                                    </span>
                                  </span>
                                  {isActive && (
                                    <motion.span
                                      layoutId={`when-check-${uc.id}`}
                                      className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full bg-primary text-background flex items-center justify-center"
                                    >
                                      <Check className="w-2 h-2" strokeWidth={3} />
                                    </motion.span>
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          <AnimatePresence initial={false}>
                            {editorOpen && (
                              <motion.div key="custom-editor" {...HEIGHT_FADE} className="overflow-hidden">
                                <div className="mt-3">
                                  <CustomTriggerEditor
                                    selection={trigger}
                                    availableEvents={eventOptions}
                                    availableEventKeys={availableEventKeys}
                                    onChange={(next) => setTriggerSelection(uc.id, next)}
                                  />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </section>

                        {/* STEP 2 — "Deliver to?" unified destinations */}
                        <section className="rounded-card ring-1 ring-border/80 bg-background/75 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="inline-flex items-center gap-2 typo-caption uppercase tracking-[0.2em] text-status-warning font-semibold">
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-status-warning/15 text-status-warning text-[10px] font-bold tabular-nums">2</span>
                              Deliver {emits.length === 1 ? 'the event' : `all ${emits.length} events`} to
                            </div>
                            <label className="inline-flex items-center gap-1.5 typo-caption text-foreground/65 font-medium cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={isCustomized}
                                onChange={() => (isCustomized ? exitCustomMode(uc.id) : enterCustomMode(uc.id))}
                                className="focus-ring w-3.5 h-3.5 rounded ring-1 ring-border accent-primary"
                              />
                              Customize per event
                            </label>
                          </div>

                          {!isCustomized ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              {destinations.map((dest) => (
                                <UnifiedDestChip
                                  key={dest.id}
                                  destination={dest}
                                  active={unified.has(dest.id)}
                                  firing={firing && unified.has(dest.id)}
                                  onToggle={() => toggleUnifiedRoute(uc.id, dest.id)}
                                  onRemove={dest.kind === 'channel' ? () => removeChannel(dest.id) : undefined}
                                />
                              ))}
                              <button
                                type="button"
                                onClick={() => setQuickAddCtx({ ucId: uc.id })}
                                className="focus-ring inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-border text-foreground/55 hover:text-foreground hover:border-foreground/40 typo-body font-medium transition-colors"
                              >
                                <Plus className="w-4 h-4" />
                                Channel
                              </button>
                            </div>
                          ) : (
                            <PerEventRouting
                              ucId={uc.id}
                              emits={emits}
                              customRoutes={customRoutes[uc.id] ?? {}}
                              destinations={destinations}
                              firing={firing}
                              onToggle={togglePerEventRoute}
                              onRemoveChannel={removeChannel}
                              onAddChannel={() => setQuickAddCtx({ ucId: uc.id })}
                            />
                          )}
                        </section>

                        {/* STEP 3 — Events digest (always visible, read-only unless customized) */}
                        {!isCustomized && (
                          <section className="rounded-card ring-1 ring-border/80 bg-foreground/[0.02] p-4">
                            <div className="inline-flex items-center gap-2 typo-caption uppercase tracking-[0.2em] text-foreground/60 font-semibold mb-2">
                              <Sparkles className="w-3.5 h-3.5 text-primary" />
                              What this capability emits
                            </div>
                            <p className="typo-body text-foreground/70 leading-snug mb-3">{subtitle}</p>
                            <div className="flex flex-col gap-1">
                              {emits.length === 0 && (
                                <div className="typo-body text-foreground/55 italic">No events emitted</div>
                              )}
                              {emits.map((ev, i) => (
                                <motion.div
                                  key={ev.event_type}
                                  initial={{ opacity: 0, x: -4 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: i * 0.04 }}
                                  className="flex items-center gap-2.5 py-1"
                                >
                                  <SignalStamp
                                    eventType={ev.event_type}
                                    active={unified.size > 0}
                                    firing={firing && unified.size > 0}
                                    delay={i * 0.1}
                                  />
                                  <span className="flex-1 min-w-0 typo-body truncate text-foreground/90">
                                    {ev.description}
                                  </span>
                                  <span className="flex-shrink-0 font-mono typo-caption text-foreground/45 truncate max-w-[180px]">
                                    {ev.event_type}
                                  </span>
                                </motion.div>
                              ))}
                            </div>
                          </section>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>

      {quickAddCtx && (
        <QuickAddCredentialModal
          category={MESSAGING_CATEGORY}
          categoryLabel="messaging channel"
          onCredentialAdded={(serviceType) => {
            void fetchCredentials()
              .then(() => {
                const added = useVaultStore
                  .getState()
                  .credentials.find(
                    (c) => c.service_type === serviceType && c.healthcheck_last_success === true,
                  );
                if (added && quickAddCtx) {
                  attachChannelAndRoute(added.id, quickAddCtx.ucId);
                }
              })
              .finally(() => setQuickAddCtx(null));
          }}
          onClose={() => setQuickAddCtx(null)}
        />
      )}

      <AnimatePresence>
        {previewUcId && previewSample && previewUc && (
          <PreviewModal
            title={previewSample.title}
            subtitle={`In-App Message preview · ${previewUc.name}`}
            onClose={() => setPreviewUcId(null)}
          >
            <MarkdownRenderer content={previewSample.body} className="typo-body leading-relaxed" />
          </PreviewModal>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Per-event routing drawer (when user opts into customization) ────────

function PerEventRouting({
  ucId,
  emits,
  customRoutes,
  destinations,
  firing,
  onToggle,
  onRemoveChannel,
  onAddChannel,
}: {
  ucId: string;
  emits: Array<{ event_type: string; description: string; default_titlebar: boolean }>;
  customRoutes: Record<string, Set<DestId>>;
  destinations: Destination[];
  firing: boolean;
  onToggle: (ucId: string, eventType: string, destId: DestId) => void;
  onRemoveChannel: (chId: string) => void;
  onAddChannel: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {emits.length === 0 && (
        <div className="typo-body text-foreground/55 italic">No events emitted</div>
      )}
      {emits.map((ev, i) => {
        const routed = customRoutes[ev.event_type] ?? new Set<DestId>();
        return (
          <div
            key={ev.event_type}
            className={`flex items-center gap-2 px-2 py-2 rounded-input transition-colors ${
              routed.size > 0 ? 'bg-status-warning/[0.10]' : 'bg-foreground/[0.02]'
            }`}
          >
            <SignalStamp eventType={ev.event_type} active={routed.size > 0} firing={firing && routed.size > 0} delay={i * 0.1} />
            <span className="flex-1 min-w-0 typo-body font-medium truncate text-foreground/90">{ev.description}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {destinations.map((dest) => (
                <RouteToggle
                  key={dest.id}
                  destination={dest}
                  active={routed.has(dest.id)}
                  firing={firing && routed.has(dest.id)}
                  delay={i * 0.1 + 0.2}
                  onToggle={() => onToggle(ucId, ev.event_type, dest.id)}
                  onRemove={dest.kind === 'channel' ? () => onRemoveChannel(dest.id) : undefined}
                />
              ))}
              <button
                type="button"
                onClick={onAddChannel}
                className="focus-ring w-8 h-8 rounded-full border border-dashed border-border text-foreground/55 hover:text-foreground hover:border-foreground/40 flex items-center justify-center transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Unified destination chip (larger, primary-tinted) ───────────────────

function UnifiedDestChip({
  destination,
  active,
  firing,
  onToggle,
  onRemove,
}: {
  destination: Destination;
  active: boolean;
  firing: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="relative group">
      <motion.button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={`focus-ring inline-flex items-center gap-2 px-3 py-1.5 rounded-full ring-1 font-medium transition-all ${
          active
            ? 'ring-primary/60 bg-primary/15 text-primary shadow-elevation-1'
            : 'ring-border bg-background text-foreground/55 hover:text-foreground hover:ring-foreground/40'
        }`}
        animate={
          firing
            ? { boxShadow: ['0 0 0 0 color-mix(in srgb, var(--color-primary) 40%, transparent)', '0 0 0 8px color-mix(in srgb, var(--color-primary) 0%, transparent)'] }
            : {}
        }
        transition={firing ? { duration: 0.9, repeat: Infinity, ease: 'easeOut' } : undefined}
      >
        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${active ? 'bg-primary/25' : 'bg-foreground/[0.05]'}`}>
          {destination.kind === 'channel' && destination.meta ? (
            <ConnectorIcon meta={destination.meta} size="w-3.5 h-3.5" />
          ) : destination.icon ? (
            <destination.icon className="w-3.5 h-3.5" />
          ) : null}
        </span>
        <span className="typo-body">{destination.shortLabel}</span>
        {active && <Check className="w-3.5 h-3.5 opacity-70" strokeWidth={3} />}
      </motion.button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove this channel"
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-status-error/80 hover:bg-status-error text-background flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <X className="w-2.5 h-2.5" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

// ─── Per-event route toggle (used in customize mode) ─────────────────────

function RouteToggle({
  destination,
  active,
  firing,
  delay,
  onToggle,
  onRemove,
}: {
  destination: Destination;
  active: boolean;
  firing: boolean;
  delay: number;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="relative group">
      <motion.button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={`focus-ring w-8 h-8 rounded-full flex items-center justify-center transition-all ${
          active
            ? 'bg-primary/15 ring-2 ring-primary/55 text-primary shadow-elevation-1'
            : 'bg-foreground/[0.04] ring-1 ring-border text-foreground/45 hover:text-foreground hover:ring-foreground/40'
        }`}
        animate={
          firing
            ? { boxShadow: ['0 0 0 0 color-mix(in srgb, var(--color-primary) 40%, transparent)', '0 0 0 6px color-mix(in srgb, var(--color-primary) 0%, transparent)'] }
            : {}
        }
        transition={firing ? { duration: 0.9, delay, repeat: Infinity, ease: 'easeOut' } : undefined}
      >
        {destination.kind === 'channel' && destination.meta ? (
          <ConnectorIcon meta={destination.meta} size="w-4 h-4" />
        ) : destination.icon ? (
          <destination.icon className="w-4 h-4" />
        ) : null}
      </motion.button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-status-error/80 hover:bg-status-error text-background flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <X className="w-2.5 h-2.5" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

// ─── Signal stamp (ported from Forge) ────────────────────────────────────

type StampKind = 'up' | 'down' | 'hold' | 'scan' | 'gem' | 'spike' | 'bolt';

function classifyEvent(eventType: string): StampKind {
  const t = eventType.toLowerCase();
  if (t.endsWith('.buy') || t.includes('.up') || t.includes('discovered')) return 'up';
  if (t.endsWith('.sell') || t.includes('.down') || t.includes('filtered_out') || t.includes('failed')) return 'down';
  if (t.endsWith('.hold') || t.includes('succeeded') || t.includes('completed')) return 'hold';
  if (t.includes('scan') || t.includes('disclosure')) return 'scan';
  if (t.includes('gem')) return 'gem';
  if (t.includes('shift') || t.includes('spike')) return 'spike';
  return 'bolt';
}

function SignalStamp({
  eventType,
  active,
  firing,
  delay,
}: {
  eventType: string;
  active: boolean;
  firing: boolean;
  delay: number;
}) {
  const color = active ? 'var(--color-status-warning)' : 'var(--color-foreground)';
  const opacity = active ? 1 : 0.35;
  const kind = classifyEvent(eventType);

  return (
    <motion.div
      className="relative flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
      style={{
        color,
        opacity,
        background: active
          ? 'color-mix(in srgb, var(--color-status-warning) 14%, transparent)'
          : 'transparent',
        boxShadow: active
          ? 'inset 0 0 0 1px color-mix(in srgb, var(--color-status-warning) 40%, transparent)'
          : 'inset 0 0 0 1px color-mix(in srgb, var(--color-foreground) 15%, transparent)',
      }}
      animate={firing ? { scale: [1, 1.15, 1] } : {}}
      transition={firing ? { duration: 0.6, delay, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      <svg viewBox="0 0 20 20" className="w-4 h-4">
        {kind === 'up' && (
          <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M 4 14 L 10 6 L 16 14" />
            <path d="M 4 17 L 16 17" strokeOpacity={0.45} />
          </g>
        )}
        {kind === 'down' && (
          <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M 4 6 L 10 14 L 16 6" />
            <path d="M 4 3 L 16 3" strokeOpacity={0.45} />
          </g>
        )}
        {kind === 'hold' && (
          <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M 4 10 L 16 10" />
            <path d="M 4 5 L 16 5" strokeOpacity={0.45} />
            <path d="M 4 15 L 16 15" strokeOpacity={0.45} />
          </g>
        )}
        {kind === 'scan' && (
          <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
            <circle cx={10} cy={10} r={6} />
            <path d="M 14.5 14.5 L 18 18" />
            <path d="M 10 4 L 10 10" strokeOpacity={0.6} />
          </g>
        )}
        {kind === 'gem' && (
          <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
            <path d="M 10 3 L 17 8 L 14 17 L 6 17 L 3 8 Z" />
            <path d="M 3 8 L 17 8 M 7 8 L 10 17 M 13 8 L 10 17" strokeOpacity={0.5} />
          </g>
        )}
        {kind === 'spike' && (
          <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M 2 13 L 6 13 L 8 6 L 11 17 L 13 10 L 18 10" />
          </g>
        )}
        {kind === 'bolt' && (
          <path
            d="M 11 2 L 4 12 L 9 12 L 7 18 L 16 8 L 11 8 L 13 2 Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={0.5}
            strokeLinejoin="round"
          />
        )}
      </svg>
    </motion.div>
  );
}

// ─── Custom trigger editor — Forge-style detailed controls behind "Edit…" ─

interface CustomTriggerEditorProps {
  selection: TriggerSelection;
  availableEvents: ThemedSelectOption[];
  availableEventKeys: string[];
  onChange: (next: TriggerSelection) => void;
}

function CustomTriggerEditor({
  selection,
  availableEvents,
  availableEventKeys,
  onChange,
}: CustomTriggerEditorProps) {
  const time = selection.time;
  const sub = time?.preset ?? 'daily';
  const hourOfDay = time?.hourOfDay ?? 9;
  const weekday = time?.weekday ?? 1;
  const poweredTime = hasTime(selection);
  const poweredEvent = hasEvent(selection);

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg ring-1 ring-border/60 bg-foreground/[0.02] p-3">
      <div className="rounded-lg ring-1 ring-primary/25 bg-primary/[0.04] p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-1.5 typo-caption font-mono uppercase tracking-wider text-primary">
            <Clock className="w-3.5 h-3.5" /> Time
          </div>
          {poweredTime ? (
            <button
              type="button"
              onClick={() => onChange(disableTimeFamily(selection))}
              className="focus-ring p-0.5 rounded text-foreground/55 hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onChange(enableTimeFamily(selection))}
              className="focus-ring inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-primary hover:bg-primary/10 typo-caption"
            >
              <Plus className="w-3 h-3" /> enable
            </button>
          )}
        </div>
        {poweredTime && (
          <>
            <div className="flex flex-wrap gap-1">
              {TIME_PRESETS.map((p) => {
                const Icon = p.icon;
                const on = sub === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => onChange(selectionForTimePreset(p.key, selection))}
                    className={`focus-ring inline-flex items-center gap-1 rounded px-2 py-0.5 typo-caption font-medium transition-colors ${
                      on
                        ? 'bg-primary/20 text-primary ring-1 ring-primary/40'
                        : 'bg-foreground/[0.04] text-foreground/65 hover:bg-foreground/[0.08]'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {p.label}
                  </button>
                );
              })}
            </div>
            {sub !== 'hourly' && (
              <div className="flex items-center gap-1.5 typo-caption">
                {sub === 'weekly' && (
                  <div className="flex gap-0.5">
                    {WEEKDAYS.map((d, i) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => onChange(updateTime(selection, { weekday: i }))}
                        className={`rounded px-1.5 py-0.5 font-mono transition-colors ${
                          weekday === i
                            ? 'bg-primary/25 text-primary'
                            : 'text-foreground/55 hover:text-foreground hover:bg-foreground/[0.05]'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
                <span className="text-foreground/55 font-mono ml-auto">@</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={hourOfDay}
                  onChange={(e) => onChange(updateTime(selection, { hourOfDay: clampHour(e.target.value) }))}
                  className="focus-ring w-12 rounded ring-1 ring-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-foreground text-center tabular-nums"
                />
                <span className="text-foreground/55 font-mono tabular-nums">:00</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-lg ring-1 ring-status-info/25 bg-status-info/[0.04] p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-1.5 typo-caption font-mono uppercase tracking-wider text-status-info">
            <Zap className="w-3.5 h-3.5" /> Event
          </div>
          {poweredEvent ? (
            <button
              type="button"
              onClick={() => onChange(disableEventFamily(selection))}
              className="focus-ring p-0.5 rounded text-foreground/55 hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onChange(enableEventFamily(selection, availableEventKeys))}
              className="focus-ring inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-status-info hover:bg-status-info/10 typo-caption"
            >
              <Plus className="w-3 h-3" /> enable
            </button>
          )}
        </div>
        {poweredEvent && (
          <ThemedSelect
            filterable
            options={
              availableEvents.length > 0
                ? availableEvents
                : [{ value: '', label: '(no events declared)' }]
            }
            value={selection.event?.eventType ?? ''}
            onValueChange={(v) => onChange(updateEvent(selection, { eventType: v }))}
            placeholder="listen for…"
          />
        )}
      </div>
    </div>
  );
}

// ─── Preview modal ────────────────────────────────────────────────────────

function PreviewModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="quickset-preview-title"
      size="full"
      portal
      containerClassName="fixed inset-0 z-[10500] flex items-center justify-center p-6"
      panelClassName="relative bg-gradient-to-b from-background via-background to-[color-mix(in_srgb,var(--color-background),var(--color-primary)_3%)] border border-primary/15 rounded-2xl shadow-elevation-4 shadow-black/30 overflow-hidden flex flex-col max-h-[calc(100vh-3rem)] w-full max-w-3xl"
    >
      <div className="absolute top-0 left-1/4 w-1/2 h-32 bg-primary/[0.04] blur-3xl pointer-events-none" />
      <div className="relative flex items-start justify-between px-6 py-4 border-b border-primary/[0.08] flex-shrink-0 bg-secondary/10">
        <div className="flex-1 min-w-0 pr-4">
          <h3
            id="quickset-preview-title"
            className="typo-body-lg font-semibold text-foreground/95 tracking-tight inline-flex items-center gap-2.5"
          >
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-card bg-primary/15 ring-1 ring-primary/30 text-primary">
              <Inbox className="w-5 h-5" />
            </span>
            {title}
          </h3>
          {subtitle && <p className="typo-body text-foreground/70 mt-1 leading-relaxed">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          className="focus-ring p-1.5 rounded-card hover:bg-secondary/60 text-foreground/80 hover:text-foreground transition-colors"
          aria-label="Close preview"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="relative flex-1 overflow-y-auto px-6 py-5 flex flex-col min-h-0">{children}</div>
    </BaseModal>
  );
}
