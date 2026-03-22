import { useEffect, useState } from 'react';
import { Grid3X3, ListChecks, Link, Clock, MessageSquare, ShieldCheck, Brain, AlertCircle, Zap, RefreshCw } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { invoke } from '@tauri-apps/api/core';
import { formatRelativeTime } from '@/lib/utils/formatters';

interface BuildSessionSummary {
  id: string;
  persona_id: string;
  phase: string;
  resolved_cells: string;
  agent_ir: string | null;
  intent: string;
  created_at: string;
  updated_at: string;
}

interface CellData {
  items?: string[];
  [key: string]: unknown;
}

const DIMENSION_META: Record<string, { icon: React.ElementType; color: string; label: string; description: string }> = {
  'use-cases':      { icon: ListChecks,  color: '#3b82f6', label: 'Use Cases',      description: 'What the agent does' },
  'connectors':     { icon: Link,        color: '#8b5cf6', label: 'Connectors',     description: 'Which services it uses' },
  'triggers':       { icon: Clock,       color: '#06b6d4', label: 'Triggers',       description: 'When it runs' },
  'messages':       { icon: MessageSquare, color: '#10b981', label: 'Messages',     description: 'How it notifies' },
  'human-review':   { icon: ShieldCheck, color: '#f59e0b', label: 'Human Review',   description: 'What needs approval' },
  'memory':         { icon: Brain,       color: '#a855f7', label: 'Memory',         description: 'What to remember' },
  'error-handling': { icon: AlertCircle, color: '#ef4444', label: 'Error Handling', description: 'What can go wrong' },
  'events':         { icon: Zap,         color: '#f97316', label: 'Events',         description: 'What to observe' },
};

const DIMENSION_ORDER = ['use-cases', 'connectors', 'triggers', 'messages', 'human-review', 'memory', 'error-handling', 'events'];

export function MatrixTab() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const [session, setSession] = useState<BuildSessionSummary | null>(null);
  const [cells, setCells] = useState<Record<string, CellData>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!selectedPersona?.id) return;
    let cancelled = false;
    setIsLoading(true);

    invoke<BuildSessionSummary | null>('get_active_build_session', { personaId: selectedPersona.id })
      .then((s) => {
        if (cancelled) return;
        if (s) {
          setSession(s);
          try {
            const parsed = typeof s.resolved_cells === 'string'
              ? JSON.parse(s.resolved_cells)
              : s.resolved_cells;
            setCells(parsed && typeof parsed === 'object' ? parsed : {});
          } catch {
            setCells({});
          }
        } else {
          // Try to load from design_context and last_design_result
          loadFromPersonaDesign();
        }
      })
      .catch(() => { loadFromPersonaDesign(); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    function loadFromPersonaDesign() {
      const p = selectedPersona;
      if (!p) { setCells({}); setSession(null); return; }

      const designCells: Record<string, CellData> = {};

      // Parse design_context for use cases
      if (p.design_context) {
        try {
          const dc = JSON.parse(p.design_context);
          if (dc.useCases?.length) {
            designCells['use-cases'] = {
              items: dc.useCases.map((uc: { title?: string; description?: string }) =>
                uc.title || uc.description || 'Use case'
              ),
            };
          }
        } catch { /* ignore */ }
      }

      // Parse last_design_result for connectors, triggers, etc.
      if (p.last_design_result) {
        try {
          const dr = JSON.parse(p.last_design_result);
          if (dr.suggested_connectors?.length) {
            designCells['connectors'] = {
              items: dr.suggested_connectors.map((c: { name?: string; purpose?: string }) =>
                `${c.name || 'connector'}${c.purpose ? ` — ${c.purpose}` : ''}`
              ),
            };
          }
          if (dr.suggested_triggers?.length) {
            designCells['triggers'] = {
              items: dr.suggested_triggers.map((t: { description?: string; trigger_type?: string }) =>
                t.description || t.trigger_type || 'trigger'
              ),
            };
          }
          if (dr.suggested_notification_channels) {
            const ch = dr.suggested_notification_channels;
            const channels = ch.channels || ch.items || (Array.isArray(ch) ? ch : []);
            if (channels.length) {
              designCells['messages'] = { items: channels.map((c: { channel?: string; target?: string } | string) => typeof c === 'string' ? c : `${c.channel || ''}${c.target ? `: ${c.target}` : ''}`) };
            }
          }
          if (dr.suggested_event_subscriptions) {
            const ev = dr.suggested_event_subscriptions;
            const evArr = ev.subscriptions || ev.items || (Array.isArray(ev) ? ev : []);
            if (evArr.length) {
              designCells['events'] = { items: evArr.map((e: { event_type?: string } | string) => typeof e === 'string' ? e : e.event_type || 'event') };
            }
          }
        } catch { /* ignore */ }
      }

      setCells(designCells);
      setSession(null);
    }

    return () => { cancelled = true; };
  }, [selectedPersona?.id]);

  if (!selectedPersona) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-violet-400" />
          <h3 className="typo-heading text-foreground/90">PersonaMatrix</h3>
          {session && (
            <span className="text-xs text-muted-foreground/50">
              Built {formatRelativeTime(session.created_at)}
            </span>
          )}
        </div>
        {session && (
          <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${
            session.phase === 'promoted' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          }`}>
            {session.phase}
          </span>
        )}
      </div>

      {session?.intent && (
        <div className="rounded-xl bg-secondary/20 border border-primary/10 px-4 py-3">
          <div className="text-xs font-mono text-muted-foreground/50 uppercase tracking-wider mb-1">Intent</div>
          <p className="text-sm text-foreground/80">{session.intent}</p>
        </div>
      )}

      {/* Dimension grid */}
      {isLoading ? (
        <div className="py-8 text-center text-muted-foreground/50 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2" />
          Loading matrix...
        </div>
      ) : !cells || Object.keys(cells).length === 0 ? (
        <div className="py-8 text-center text-muted-foreground/50 text-sm">
          No matrix data available. Build or rebuild this persona to generate dimensions.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {DIMENSION_ORDER.map((key) => {
            const meta = DIMENSION_META[key];
            if (!meta) return null;
            const cell = cells[key] as CellData | undefined;
            const items = cell?.items || [];
            const resolved = items.length > 0 || cell != null;
            const Icon = meta.icon;

            return (
              <div
                key={key}
                className={`rounded-xl border px-4 py-3 transition-colors ${
                  resolved
                    ? 'border-primary/15 bg-secondary/10'
                    : 'border-primary/[0.06] bg-secondary/5 opacity-60'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: meta.color + '18' }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground/85">{meta.label}</span>
                    <span className="text-xs text-muted-foreground/50 ml-2">{meta.description}</span>
                  </div>
                  {resolved && (
                    <span className="ml-auto text-xs text-emerald-400/70">resolved</span>
                  )}
                </div>
                {items.length > 0 ? (
                  <ul className="space-y-1 pl-8">
                    {items.map((item, i) => (
                      <li key={i} className="text-xs text-foreground/70 leading-relaxed flex gap-1.5">
                        <span className="text-muted-foreground/40 flex-shrink-0">-</span>
                        <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
                      </li>
                    ))}
                  </ul>
                ) : resolved ? (
                  <p className="text-xs text-muted-foreground/50 pl-8">Configured (no items listed)</p>
                ) : (
                  <p className="text-xs text-muted-foreground/40 pl-8">Not configured</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
