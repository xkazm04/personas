// @ts-nocheck — visual-review prototype; see MessagingPickerShared.tsx for
// the cleanup checklist that fires when one variant wins.
//
// Variant A — "Chip Rail".
//
// Each UC is a single compact card. Below the description sits ONE horizontal
// chip rail that mixes three concern groups, separated by vertical dividers:
//
//   [Triggers]  │  [Channels]  │  [Bell]  [Test]
//
// Triggers: Manual / Hourly / Daily / Weekly / Event (same model as the
// current production picker). Channels: icon stack with built-in pinned
// first + vault messaging credentials. Bell: popover with per-event
// TitleBar opt-ins. Test: sends the UC's sample_output to the active
// channels and renders a per-channel success/failure badge in-line.
//
// Pros: compact, many UCs fit on one screen, minimal chrome.
// Cons: dense; per-channel config (slack channel, telegram chat id) is
// only reachable via long-press.

import { useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Plus,
  Sparkles,
  Wand2,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  BELL_ICON,
  CHANNEL_KIND_ICON,
  DEV_CLONE_FIXTURE_USE_CASES,
  EMPTY_CHANNEL_STATE,
  FALLBACK_SAMPLE,
  MESSAGE_COMPOSITION,
  MOCK_EMIT_EVENTS_BY_UC,
  MOCK_MESSAGING_CHANNELS,
  SAMPLE_MESSAGE_BY_UC,
  mockTestDelivery,
  type TestDeliveryResult,
  type UCChannelState,
} from './MessagingPickerShared';

const TRIGGER_CHIPS = [
  { id: 'manual',  label: 'Manual', icon: Wand2,    description: 'Runs when you invoke it' },
  { id: 'hourly',  label: 'Hourly', icon: Clock,    description: 'Top of every hour' },
  { id: 'daily',   label: 'Daily',  icon: Calendar, description: 'Once per day' },
  { id: 'weekly',  label: 'Weekly', icon: Calendar, description: 'Once per week' },
  { id: 'event',   label: 'Event',  icon: Zap,      description: 'Fires on another UC emitting' },
];

export function MessagingPickerVariantA() {
  const useCases = DEV_CLONE_FIXTURE_USE_CASES;

  // Per-UC channel + bell state, shared across UCs when MESSAGE_COMPOSITION=shared.
  const [channelStates, setChannelStates] = useState<Record<string, UCChannelState>>(() => {
    const out: Record<string, UCChannelState> = {};
    const defaults = EMPTY_CHANNEL_STATE();
    for (const uc of useCases) out[uc.id] = { channelIds: new Set(defaults.channelIds), titlebarEventIds: new Set() };
    // Seed bell opt-ins from template defaults.
    for (const uc of useCases) {
      for (const ev of MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? []) {
        if (ev.default_titlebar) out[uc.id].titlebarEventIds.add(ev.event_type);
      }
    }
    return out;
  });

  const [triggerByUc, setTriggerByUc] = useState<Record<string, string>>(
    () => Object.fromEntries(useCases.map((u) => [u.id, 'weekly'])),
  );

  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(useCases.map((u) => u.id)));

  // Transient UI state per UC for inline popovers + test results.
  const [openBellFor, setOpenBellFor] = useState<string | null>(null);
  const [testResultsByUc, setTestResultsByUc] = useState<Record<string, TestDeliveryResult[]>>({});
  const [testingUc, setTestingUc] = useState<string | null>(null);

  function toggleChannel(ucId: string, channelId: string) {
    const ch = MOCK_MESSAGING_CHANNELS.find((c) => c.id === channelId);
    if (ch?.alwaysOn) return; // built-in is locked on
    setChannelStates((prev) => {
      const sharing = MESSAGE_COMPOSITION === 'shared';
      const targets = sharing ? Object.keys(prev) : [ucId];
      const next = { ...prev };
      for (const k of targets) {
        const st = { ...next[k], channelIds: new Set(next[k].channelIds) };
        if (st.channelIds.has(channelId)) st.channelIds.delete(channelId);
        else st.channelIds.add(channelId);
        next[k] = st;
      }
      return next;
    });
  }

  function toggleTitlebarEvent(ucId: string, eventType: string) {
    setChannelStates((prev) => {
      const st = { ...prev[ucId], titlebarEventIds: new Set(prev[ucId].titlebarEventIds) };
      if (st.titlebarEventIds.has(eventType)) st.titlebarEventIds.delete(eventType);
      else st.titlebarEventIds.add(eventType);
      return { ...prev, [ucId]: st };
    });
  }

  async function runTest(ucId: string) {
    setTestingUc(ucId);
    const state = channelStates[ucId];
    const sample = SAMPLE_MESSAGE_BY_UC[ucId] ?? FALLBACK_SAMPLE;
    const results = await mockTestDelivery(Array.from(state.channelIds), sample);
    setTestResultsByUc((prev) => ({ ...prev, [ucId]: results }));
    setTestingUc(null);
    setTimeout(() => setTestResultsByUc((prev) => { const n = { ...prev }; delete n[ucId]; return n; }), 3500);
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <header className="flex-shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-brand-purple" />
          <h3 className="text-lg font-semibold text-foreground">Choose capabilities — Chip Rail</h3>
          <span className="ml-auto text-xs text-foreground/60">
            Triggers · Channels · Bell — all inline, per UC
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
        {useCases.map((uc) => {
          const on = enabled.has(uc.id);
          const state = channelStates[uc.id];
          const triggerId = triggerByUc[uc.id];
          const bellCount = state.titlebarEventIds.size;
          const emits = MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? [];
          const activeResults = testResultsByUc[uc.id];
          const isTesting = testingUc === uc.id;
          return (
            <div
              key={uc.id}
              className={`rounded-card border transition-all ${on ? 'bg-card-bg border-card-border' : 'bg-foreground/[0.02] border-border opacity-60'}`}
            >
              {/* Top row: enable toggle + title + summary */}
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setEnabled((prev) => { const n = new Set(prev); if (n.has(uc.id)) n.delete(uc.id); else n.add(uc.id); return n; })}
                  className={`w-9 h-5 rounded-full transition-colors relative ${on ? 'bg-brand-cyan/70' : 'bg-foreground/20'}`}
                  aria-pressed={on}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
                </button>
                <h4 className="flex-1 typo-body-lg font-medium text-foreground">{uc.name}</h4>
                <span className="text-xs text-foreground/50">{uc.id}</span>
              </div>

              {/* Chip rail — only rendered when UC is on */}
              {on && (
                <div className="flex items-center gap-2 flex-wrap px-4 pb-3 pt-1 border-t border-border/50">
                  {/* Trigger chips */}
                  {TRIGGER_CHIPS.map((chip) => {
                    const Icon = chip.icon;
                    const active = triggerId === chip.id;
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => setTriggerByUc((prev) => ({ ...prev, [uc.id]: chip.id }))}
                        title={chip.description}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all ${
                          active
                            ? 'bg-brand-cyan/15 border-brand-cyan/40 text-brand-cyan'
                            : 'bg-foreground/[0.03] border-border text-foreground hover:bg-foreground/[0.06]'
                        }`}
                      >
                        <Icon className="w-3 h-3" />
                        {chip.label}
                      </button>
                    );
                  })}

                  <div className="h-5 w-px bg-border mx-1" aria-hidden />

                  {/* Channel icons */}
                  {MOCK_MESSAGING_CHANNELS.map((ch) => {
                    const Icon = ch.icon;
                    const active = state.channelIds.has(ch.id);
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => toggleChannel(uc.id, ch.id)}
                        title={`${ch.label}${ch.target ? ` · ${ch.target}` : ''}`}
                        aria-pressed={active}
                        aria-disabled={ch.alwaysOn}
                        className={`w-8 h-8 rounded-full border flex items-center justify-center transition-all ${
                          active
                            ? `bg-card-bg border-brand-cyan/50 ${ch.color}`
                            : 'bg-foreground/[0.03] border-border text-foreground/50 hover:bg-foreground/[0.06]'
                        } ${ch.alwaysOn ? 'cursor-default ring-1 ring-primary/30' : ''}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-foreground/60 hover:text-foreground hover:bg-foreground/[0.04]"
                    title="Add messaging credential via Vault"
                  >
                    <Plus className="w-3 h-3" /> add
                  </button>

                  <div className="h-5 w-px bg-border mx-1" aria-hidden />

                  {/* Bell popover trigger */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenBellFor(openBellFor === uc.id ? null : uc.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all ${
                        bellCount > 0
                          ? 'bg-brand-purple/15 border-brand-purple/40 text-brand-purple'
                          : 'bg-foreground/[0.03] border-border text-foreground/60 hover:bg-foreground/[0.06]'
                      }`}
                    >
                      <Bell className="w-3 h-3" />
                      {bellCount > 0 ? `Bell · ${bellCount}` : 'Bell'}
                      <ChevronDown className={`w-3 h-3 transition-transform ${openBellFor === uc.id ? 'rotate-180' : ''}`} />
                    </button>
                    {openBellFor === uc.id && (
                      <div className="absolute right-0 top-9 z-10 w-80 rounded-card border border-border bg-card-bg shadow-elevation-3 p-2">
                        <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-foreground/50">
                          Ping the TitleBar bell when this UC emits:
                        </div>
                        <ul className="space-y-0.5">
                          {emits.length === 0 && (
                            <li className="px-2 py-2 text-xs text-foreground/50 italic">This UC emits no events.</li>
                          )}
                          {emits.map((ev) => {
                            const active = state.titlebarEventIds.has(ev.event_type);
                            return (
                              <li key={ev.event_type}>
                                <button
                                  type="button"
                                  onClick={() => toggleTitlebarEvent(uc.id, ev.event_type)}
                                  className="w-full flex items-start gap-2 text-left px-2 py-1.5 rounded-md hover:bg-foreground/[0.04] transition-colors"
                                >
                                  <div className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${active ? 'bg-brand-purple/30 border-brand-purple' : 'border-border'}`}>
                                    {active && <CheckCircle2 className="w-3 h-3 text-brand-purple" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs font-mono text-foreground">{ev.event_type}</div>
                                    <div className="text-[11px] text-foreground/60 mt-0.5">{ev.description}</div>
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Test button */}
                  <button
                    type="button"
                    onClick={() => runTest(uc.id)}
                    disabled={isTesting}
                    className="inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-1 text-xs text-brand-cyan hover:bg-brand-cyan/20 disabled:opacity-50"
                  >
                    <Activity className={`w-3 h-3 ${isTesting ? 'animate-pulse' : ''}`} />
                    {isTesting ? 'Sending…' : 'Test'}
                  </button>

                  {/* Inline test results */}
                  {activeResults && (
                    <div className="w-full flex flex-wrap items-center gap-1.5 pt-2 text-[11px]">
                      {activeResults.map((r) => {
                        const ch = MOCK_MESSAGING_CHANNELS.find((c) => c.id === r.channelId);
                        const Icon = ch?.icon ?? Bell;
                        return (
                          <span
                            key={r.channelId}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
                              r.success
                                ? 'bg-status-success/10 border-status-success/30 text-status-success'
                                : 'bg-status-error/10 border-status-error/30 text-status-error'
                            }`}
                            title={r.error}
                          >
                            {r.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            <Icon className="w-3 h-3" />
                            {ch?.label} · {r.latencyMs}ms
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
