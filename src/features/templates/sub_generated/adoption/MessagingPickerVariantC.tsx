// @ts-nocheck — visual-review prototype; see MessagingPickerShared.tsx for
// the cleanup checklist that fires when one variant wins.
//
// Variant C — "Pipeline Canvas".
//
// Each UC renders as a horizontal pipeline showing 4 zones that match the
// runtime dataflow:
//
//   [ Trigger ] ─▶ [ Use Case ] ─▶ [ Channels ] ─▶ [ Notifications ]
//
// All zones are in-place editable (no drawers). A single "Test run" at
// the bottom of each UC dispatches the sample through the full pipeline,
// rendering a mock Slack card + bell toast + inbox entry simultaneously
// so the user sees exactly what a real execution produces.

import { useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  Play,
  Plus,
  Sparkles,
  Wand2,
  XCircle,
  Zap,
} from 'lucide-react';
import {
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
  { id: 'manual',  label: 'Manual', icon: Wand2    },
  { id: 'hourly',  label: 'Hourly', icon: Clock    },
  { id: 'daily',   label: 'Daily',  icon: Calendar },
  { id: 'weekly',  label: 'Weekly', icon: Calendar },
  { id: 'event',   label: 'Event',  icon: Zap      },
];

export function MessagingPickerVariantC() {
  const useCases = DEV_CLONE_FIXTURE_USE_CASES;

  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(useCases.map((u) => u.id)));
  const [triggerByUc, setTriggerByUc] = useState<Record<string, string>>(
    () => Object.fromEntries(useCases.map((u) => [u.id, 'weekly'])),
  );
  const [channelStates, setChannelStates] = useState<Record<string, UCChannelState>>(() => {
    const out: Record<string, UCChannelState> = {};
    for (const uc of useCases) {
      const d = EMPTY_CHANNEL_STATE();
      out[uc.id] = { channelIds: new Set(d.channelIds), titlebarEventIds: new Set() };
      for (const ev of MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? []) {
        if (ev.default_titlebar) out[uc.id].titlebarEventIds.add(ev.event_type);
      }
    }
    return out;
  });
  const [testResults, setTestResults] = useState<Record<string, TestDeliveryResult[]>>({});
  const [testing, setTesting] = useState<string | null>(null);

  function toggleChannel(ucId: string, channelId: string) {
    const ch = MOCK_MESSAGING_CHANNELS.find((c) => c.id === channelId);
    if (ch?.alwaysOn) return;
    setChannelStates((prev) => {
      const targets = MESSAGE_COMPOSITION === 'shared' ? Object.keys(prev) : [ucId];
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

  function toggleBellEvent(ucId: string, eventType: string) {
    setChannelStates((prev) => {
      const st = { ...prev[ucId], titlebarEventIds: new Set(prev[ucId].titlebarEventIds) };
      if (st.titlebarEventIds.has(eventType)) st.titlebarEventIds.delete(eventType);
      else st.titlebarEventIds.add(eventType);
      return { ...prev, [ucId]: st };
    });
  }

  async function runTest(ucId: string) {
    setTesting(ucId);
    const state = channelStates[ucId];
    const sample = SAMPLE_MESSAGE_BY_UC[ucId] ?? FALLBACK_SAMPLE;
    const results = await mockTestDelivery(Array.from(state.channelIds), sample);
    setTestResults((prev) => ({ ...prev, [ucId]: results }));
    setTesting(null);
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <header className="flex-shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-brand-purple" />
          <h3 className="text-lg font-semibold text-foreground">Choose capabilities — Pipeline Canvas</h3>
          <span className="ml-auto text-xs text-foreground/60">
            Visualises the runtime dataflow; hit Test run for a preview
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {useCases.map((uc) => {
          const on = enabled.has(uc.id);
          const state = channelStates[uc.id];
          const triggerId = triggerByUc[uc.id];
          const bellCount = state.titlebarEventIds.size;
          const emits = MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? [];
          const sample = SAMPLE_MESSAGE_BY_UC[uc.id] ?? FALLBACK_SAMPLE;

          return (
            <div
              key={uc.id}
              className={`rounded-card border overflow-hidden ${on ? 'bg-card-bg border-card-border' : 'bg-foreground/[0.02] border-border opacity-60'}`}
            >
              {/* UC row header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60">
                <button
                  type="button"
                  onClick={() => setEnabled((prev) => { const n = new Set(prev); if (n.has(uc.id)) n.delete(uc.id); else n.add(uc.id); return n; })}
                  className={`w-9 h-5 rounded-full transition-colors relative ${on ? 'bg-brand-cyan/70' : 'bg-foreground/20'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
                </button>
                <h4 className="flex-1 typo-body-lg font-medium text-foreground">{uc.name}</h4>
                <span className="text-xs text-foreground/50 font-mono">{uc.id}</span>
              </div>

              {on && (
                <>
                  {/* Pipeline zones */}
                  <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-stretch gap-0 px-4 py-4">
                    {/* Zone 1 — Trigger */}
                    <div className="flex flex-col gap-2 rounded-card border border-border bg-foreground/[0.02] p-3">
                      <div className="text-[10px] uppercase tracking-wider text-foreground/55 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Trigger
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {TRIGGER_CHIPS.map((chip) => {
                          const Icon = chip.icon;
                          const active = triggerId === chip.id;
                          return (
                            <button
                              key={chip.id}
                              type="button"
                              onClick={() => setTriggerByUc((prev) => ({ ...prev, [uc.id]: chip.id }))}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-all ${
                                active
                                  ? 'bg-brand-cyan/15 border-brand-cyan/40 text-brand-cyan'
                                  : 'bg-foreground/[0.03] border-border text-foreground/70 hover:text-foreground'
                              }`}
                            >
                              <Icon className="w-3 h-3" />
                              {chip.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <ArrowRight className="self-center w-4 h-4 mx-2 text-foreground/30" />

                    {/* Zone 2 — Use Case (purpose label) */}
                    <div className="flex flex-col justify-center items-center rounded-card border border-dashed border-border bg-foreground/[0.015] p-3 text-center">
                      <div className="text-[10px] uppercase tracking-wider text-foreground/55 mb-1 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Runs
                      </div>
                      <div className="text-xs font-medium text-foreground leading-tight">
                        {uc.name}
                      </div>
                      <div className="text-[10px] text-foreground/50 mt-1">
                        produces: <span className="font-mono">{emits.length}</span> events
                      </div>
                    </div>

                    <ArrowRight className="self-center w-4 h-4 mx-2 text-foreground/30" />

                    {/* Zone 3 — Channels */}
                    <div className="flex flex-col gap-2 rounded-card border border-border bg-foreground/[0.02] p-3">
                      <div className="text-[10px] uppercase tracking-wider text-foreground/55 flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" /> Channels
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {MOCK_MESSAGING_CHANNELS.map((ch) => {
                          const Icon = ch.icon;
                          const active = state.channelIds.has(ch.id);
                          return (
                            <button
                              key={ch.id}
                              type="button"
                              onClick={() => toggleChannel(uc.id, ch.id)}
                              title={`${ch.label}${ch.target ? ` · ${ch.target}` : ''}`}
                              className={`w-7 h-7 rounded-full border flex items-center justify-center transition-all ${
                                active
                                  ? `bg-card-bg border-brand-cyan/50 ${ch.color}`
                                  : 'bg-foreground/[0.03] border-border text-foreground/40 hover:text-foreground'
                              } ${ch.alwaysOn ? 'ring-1 ring-primary/30' : ''}`}
                            >
                              <Icon className="w-3 h-3" />
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className="w-7 h-7 rounded-full border border-dashed border-border text-foreground/40 hover:text-foreground flex items-center justify-center"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <ArrowRight className="self-center w-4 h-4 mx-2 text-foreground/30" />

                    {/* Zone 4 — Notifications */}
                    <div className="flex flex-col gap-2 rounded-card border border-border bg-foreground/[0.02] p-3">
                      <div className="text-[10px] uppercase tracking-wider text-foreground/55 flex items-center gap-1">
                        <Bell className="w-3 h-3" /> TitleBar bell
                        <span className="ml-auto text-brand-purple font-semibold">{bellCount}</span>
                      </div>
                      <div className="space-y-0.5 max-h-24 overflow-y-auto">
                        {emits.length === 0 && (
                          <div className="text-[11px] text-foreground/50 italic">no events</div>
                        )}
                        {emits.map((ev) => {
                          const active = state.titlebarEventIds.has(ev.event_type);
                          return (
                            <button
                              key={ev.event_type}
                              type="button"
                              onClick={() => toggleBellEvent(uc.id, ev.event_type)}
                              className="w-full flex items-center gap-1.5 text-left px-1 py-0.5 rounded hover:bg-foreground/[0.04]"
                            >
                              <div className={`w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center ${active ? 'bg-brand-purple/30 border-brand-purple' : 'border-border'}`}>
                                {active && <CheckCircle2 className="w-2 h-2 text-brand-purple" />}
                              </div>
                              <span className="text-[10px] font-mono text-foreground/80 truncate">{ev.event_type}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Test run + preview strip */}
                  <div className="border-t border-border bg-foreground/[0.015] px-4 py-3 flex items-start gap-4">
                    <button
                      type="button"
                      onClick={() => runTest(uc.id)}
                      disabled={testing === uc.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-2 text-xs text-brand-cyan hover:bg-brand-cyan/20 disabled:opacity-50 flex-shrink-0"
                    >
                      <Play className={`w-3.5 h-3.5 ${testing === uc.id ? 'animate-pulse' : ''}`} />
                      {testing === uc.id ? 'Running…' : 'Test run'}
                    </button>

                    {/* Pipeline preview: Slack card + bell toast + inbox */}
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      {/* Messaging preview */}
                      <div className="rounded-card border border-border bg-card-bg p-2">
                        <div className="text-[9px] uppercase tracking-wider text-foreground/50 mb-1">Messaging</div>
                        <div className="text-[11px] font-semibold text-foreground truncate">{sample.title}</div>
                        <div className="text-[10px] text-foreground/65 line-clamp-2 leading-tight mt-0.5">
                          {sample.body.split('\n')[0]}
                        </div>
                      </div>
                      {/* Bell toast preview */}
                      <div className="rounded-card border border-brand-purple/30 bg-brand-purple/5 p-2">
                        <div className="text-[9px] uppercase tracking-wider text-brand-purple mb-1 flex items-center gap-1">
                          <Bell className="w-2.5 h-2.5" /> TitleBar toast
                        </div>
                        <div className="text-[10px] text-foreground">
                          {bellCount > 0
                            ? `${bellCount} event${bellCount === 1 ? '' : 's'} will ping the bell`
                            : 'No bell subscriptions yet'}
                        </div>
                      </div>
                      {/* Delivery results */}
                      <div className="rounded-card border border-border bg-card-bg p-2">
                        <div className="text-[9px] uppercase tracking-wider text-foreground/50 mb-1">Delivery</div>
                        {!testResults[uc.id] && (
                          <div className="text-[10px] text-foreground/50 italic">Run test to see results</div>
                        )}
                        {testResults[uc.id] && (
                          <div className="flex flex-col gap-0.5">
                            {testResults[uc.id].map((r) => {
                              const ch = MOCK_MESSAGING_CHANNELS.find((c) => c.id === r.channelId);
                              return (
                                <div key={r.channelId} className={`flex items-center gap-1 text-[10px] ${r.success ? 'text-status-success' : 'text-status-error'}`}>
                                  {r.success ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
                                  <span className="truncate flex-1">{ch?.label}</span>
                                  <span className="text-foreground/50">{r.latencyMs}ms</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
