// @ts-nocheck — visual-review prototype; see MessagingPickerShared.tsx for
// the cleanup checklist that fires when one variant wins.
//
// Variant B — "Drawer Tabs".
//
// UC cards are collapsed by default, showing just title + on/off + a
// one-line trigger+channel summary. Expanding opens a 4-tab drawer:
//
//   [Trigger] [Channels] [Notifications] [Preview]
//
// Progressive disclosure — each concern has breathing room and can show
// richer controls (per-channel config form, per-event description text,
// full markdown preview of the sample output).

import { useState } from 'react';
import {
  Activity,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Plus,
  Radio,
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

type Tab = 'trigger' | 'channels' | 'notifications' | 'preview';

const TABS: Array<{ id: Tab; label: string; icon: typeof Clock }> = [
  { id: 'trigger',        label: 'Trigger',        icon: Clock },
  { id: 'channels',       label: 'Channels',       icon: Radio },
  { id: 'notifications',  label: 'Notifications',  icon: Bell },
  { id: 'preview',        label: 'Preview',        icon: Sparkles },
];

const TRIGGER_CHIPS = [
  { id: 'manual',  label: 'Manual', icon: Wand2    },
  { id: 'hourly',  label: 'Hourly', icon: Clock    },
  { id: 'daily',   label: 'Daily',  icon: Calendar },
  { id: 'weekly',  label: 'Weekly', icon: Calendar },
  { id: 'event',   label: 'Event',  icon: Zap      },
];

export function MessagingPickerVariantB() {
  const useCases = DEV_CLONE_FIXTURE_USE_CASES;

  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(useCases.map((u) => u.id)));
  const [expanded, setExpanded] = useState<string | null>(useCases[0]?.id ?? null);
  const [activeTabByUc, setActiveTabByUc] = useState<Record<string, Tab>>(
    () => Object.fromEntries(useCases.map((u) => [u.id, 'trigger' as Tab])),
  );
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
          <h3 className="text-lg font-semibold text-foreground">Choose capabilities — Drawer Tabs</h3>
          <span className="ml-auto text-xs text-foreground/60">
            Expand a UC for full trigger / channel / bell / preview config
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-2.5">
        {useCases.map((uc) => {
          const on = enabled.has(uc.id);
          const isOpen = expanded === uc.id;
          const state = channelStates[uc.id];
          const triggerId = triggerByUc[uc.id];
          const bellCount = state.titlebarEventIds.size;
          const channelCount = state.channelIds.size;
          const activeTab = activeTabByUc[uc.id];
          const emits = MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? [];
          const sample = SAMPLE_MESSAGE_BY_UC[uc.id] ?? FALLBACK_SAMPLE;

          return (
            <div
              key={uc.id}
              className={`rounded-card border overflow-hidden transition-all ${on ? 'bg-card-bg border-card-border' : 'bg-foreground/[0.02] border-border opacity-60'}`}
            >
              {/* Row header — always visible */}
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : uc.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-foreground/[0.02] transition-colors"
              >
                <span
                  role="switch"
                  aria-checked={on}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnabled((prev) => { const n = new Set(prev); if (n.has(uc.id)) n.delete(uc.id); else n.add(uc.id); return n; });
                  }}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${on ? 'bg-brand-cyan/70' : 'bg-foreground/20'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="typo-body-lg font-medium text-foreground truncate">{uc.name}</div>
                  <div className="flex items-center gap-2 text-[11px] text-foreground/55 mt-0.5">
                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {triggerId}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1"><Radio className="w-3 h-3" /> {channelCount} {channelCount === 1 ? 'channel' : 'channels'}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1"><Bell className="w-3 h-3" /> {bellCount}</span>
                  </div>
                </div>
                {isOpen ? <ChevronDown className="w-4 h-4 text-foreground/60" /> : <ChevronRight className="w-4 h-4 text-foreground/60" />}
              </button>

              {/* Drawer */}
              {isOpen && on && (
                <div className="border-t border-border">
                  {/* Tab bar */}
                  <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border bg-foreground/[0.015]">
                    {TABS.map((tab) => {
                      const active = activeTab === tab.id;
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTabByUc((prev) => ({ ...prev, [uc.id]: tab.id }))}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-all ${
                            active
                              ? 'bg-card-bg border border-card-border text-foreground'
                              : 'text-foreground/60 hover:text-foreground hover:bg-foreground/[0.03]'
                          }`}
                        >
                          <Icon className="w-3 h-3" />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="p-4">
                    {activeTab === 'trigger' && (
                      <div className="flex flex-wrap gap-2">
                        {TRIGGER_CHIPS.map((chip) => {
                          const Icon = chip.icon;
                          const active = triggerId === chip.id;
                          return (
                            <button
                              key={chip.id}
                              type="button"
                              onClick={() => setTriggerByUc((prev) => ({ ...prev, [uc.id]: chip.id }))}
                              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-all ${
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
                        {triggerId === 'event' && (
                          <div className="w-full mt-2">
                            <select className="w-full rounded-input bg-input-bg border border-border px-3 py-2 text-sm text-foreground">
                              <option>stocks.signals.buy (uc_signals)</option>
                              <option>stocks.congress.sector_shift (uc_congressional_scan)</option>
                              <option>stocks.gems.discovered (uc_gems)</option>
                            </select>
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === 'channels' && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {MOCK_MESSAGING_CHANNELS.map((ch) => {
                          const Icon = ch.icon;
                          const active = state.channelIds.has(ch.id);
                          return (
                            <button
                              key={ch.id}
                              type="button"
                              onClick={() => toggleChannel(uc.id, ch.id)}
                              className={`rounded-card border p-3 text-left transition-all ${
                                active
                                  ? 'bg-card-bg border-brand-cyan/50 ring-2 ring-brand-cyan/20'
                                  : 'bg-foreground/[0.03] border-border hover:bg-foreground/[0.06]'
                              } ${ch.alwaysOn ? 'cursor-default' : ''}`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <Icon className={`w-4 h-4 ${ch.color}`} />
                                <span className="text-sm font-medium text-foreground truncate">{ch.label}</span>
                                {ch.alwaysOn && <span className="ml-auto text-[9px] uppercase tracking-wider text-primary">default</span>}
                              </div>
                              {ch.target && (
                                <div className="text-[11px] text-foreground/55 font-mono truncate">{ch.target}</div>
                              )}
                              {!ch.target && (
                                <div className="text-[11px] text-foreground/50 italic">local inbox</div>
                              )}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className="rounded-card border border-dashed border-border p-3 text-xs text-foreground/60 hover:text-foreground hover:bg-foreground/[0.04]"
                        >
                          <Plus className="w-4 h-4 mb-1 inline" /> Add from Vault
                        </button>
                      </div>
                    )}

                    {activeTab === 'notifications' && (
                      <div className="space-y-1">
                        <div className="text-[11px] uppercase tracking-wider text-foreground/50 mb-2">
                          Ping the TitleBar bell when this UC emits
                        </div>
                        {emits.length === 0 ? (
                          <div className="text-xs text-foreground/50 italic py-2">This UC emits no events.</div>
                        ) : (
                          emits.map((ev) => {
                            const active = state.titlebarEventIds.has(ev.event_type);
                            return (
                              <button
                                key={ev.event_type}
                                type="button"
                                onClick={() => toggleBellEvent(uc.id, ev.event_type)}
                                className="w-full flex items-start gap-2.5 text-left px-2 py-2 rounded-md hover:bg-foreground/[0.04] transition-colors"
                              >
                                <div className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${active ? 'bg-brand-purple/30 border-brand-purple' : 'border-border'}`}>
                                  {active && <CheckCircle2 className="w-3 h-3 text-brand-purple" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-mono text-foreground">{ev.event_type}</div>
                                  <div className="text-[11px] text-foreground/60 mt-0.5">{ev.description}</div>
                                </div>
                                {ev.default_titlebar && (
                                  <span className="text-[9px] uppercase tracking-wider text-brand-purple mt-1">recommended</span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}

                    {activeTab === 'preview' && (
                      <div className="space-y-3">
                        <div className="rounded-card border border-border bg-foreground/[0.02] p-3 font-mono text-xs">
                          <div className="text-foreground/80 font-semibold mb-1">{sample.title}</div>
                          <pre className="whitespace-pre-wrap text-foreground/70 leading-relaxed">{sample.body}</pre>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => runTest(uc.id)}
                            disabled={testing === uc.id}
                            className="inline-flex items-center gap-1.5 rounded-md border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-1.5 text-xs text-brand-cyan hover:bg-brand-cyan/20 disabled:opacity-50"
                          >
                            <Activity className={`w-3 h-3 ${testing === uc.id ? 'animate-pulse' : ''}`} />
                            {testing === uc.id ? 'Sending…' : 'Send test to selected channels'}
                          </button>
                          <span className="text-[11px] text-foreground/50">
                            → {state.channelIds.size} channel{state.channelIds.size === 1 ? '' : 's'}
                          </span>
                        </div>
                        {testResults[uc.id] && (
                          <div className="flex flex-wrap gap-1.5 text-[11px]">
                            {testResults[uc.id].map((r) => {
                              const ch = MOCK_MESSAGING_CHANNELS.find((c) => c.id === r.channelId);
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
                                  {ch?.label} · {r.latencyMs}ms
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
