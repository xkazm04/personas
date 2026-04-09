import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zap, ChevronDown, Check, Radio } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { testEventFlow } from '@/api/overview/events';
import { listTriggers } from '@/api/pipeline/triggers';
import { listSubscriptions } from '@/api/overview/events';
import { PersonaSelector } from '@/features/shared/components/forms/PersonaSelector';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { PersonaEvent, PersonaTrigger } from '@/lib/types/types';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';

/** Extract the event_type from a trigger or subscription record. */
function extractEventType(trigger: PersonaTrigger): string | null {
  if (!trigger.config) return null;
  try {
    const cfg = JSON.parse(trigger.config) as Record<string, unknown>;
    // Publishers: schedule/polling/webhook/chain/composite set event_type
    if (typeof cfg.event_type === 'string' && cfg.event_type) return cfg.event_type;
    // Listeners: event_listener sets listen_event_type
    if (typeof cfg.listen_event_type === 'string' && cfg.listen_event_type) return cfg.listen_event_type;
  } catch { /* skip */ }
  // schedule/polling/webhook without explicit event_type → default
  if (['schedule', 'polling', 'webhook'].includes(trigger.trigger_type)) {
    return 'trigger_fired';
  }
  return null;
}

/** Deduplicate and sort event type strings. */
function uniqueSorted(items: string[]): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

export function TestTab() {
  const personas = useAgentStore((s) => s.personas);

  // Step 1: pick a persona
  const [selectedPersonaId, setSelectedPersonaId] = useState('');

  // Step 2: pick an event connected to that persona
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [selectedEvent, setSelectedEvent] = useState('');
  const [eventDropdownOpen, setEventDropdownOpen] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);

  // Step 3: payload as plain text
  const [payloadText, setPayloadText] = useState('');

  // Result
  const [testResult, setTestResult] = useState<PersonaEvent | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === selectedPersonaId) ?? null,
    [personas, selectedPersonaId],
  );

  // When persona changes, load its event types from triggers + subscriptions
  useEffect(() => {
    setSelectedEvent('');
    setEventTypes([]);
    setTestResult(null);
    setError(null);

    if (!selectedPersonaId) return;

    let stale = false;
    setIsLoadingEvents(true);

    Promise.all([
      listTriggers(selectedPersonaId).catch(() => [] as PersonaTrigger[]),
      listSubscriptions(selectedPersonaId).catch(() => [] as PersonaEventSubscription[]),
    ]).then(([triggers, subs]) => {
      if (stale) return;
      const types: string[] = [];
      for (const t of triggers) {
        const et = extractEventType(t);
        if (et) types.push(et);
      }
      for (const s of subs) {
        if (s.event_type) types.push(s.event_type);
      }
      const deduped = uniqueSorted(types);
      setEventTypes(deduped);
      // Auto-select if there's exactly one event
      if (deduped.length === 1) setSelectedEvent(deduped[0]);
      setIsLoadingEvents(false);
    });

    return () => { stale = true; };
  }, [selectedPersonaId]);

  const handleTestFire = useCallback(async () => {
    if (!selectedEvent.trim()) return;
    setIsTesting(true);
    setTestResult(null);
    setError(null);
    try {
      // Transform plain text into a simple JSON payload.
      // If the text is already valid JSON (power-user), pass it through.
      // Otherwise wrap as { "message": "<text>" } so the persona receives
      // a clean object regardless of what the user typed.
      let payload: string | undefined;
      const trimmed = payloadText.trim();
      if (trimmed) {
        try {
          JSON.parse(trimmed);
          // Already valid JSON — pass through verbatim
          payload = trimmed;
        } catch {
          // Plain text — wrap in a simple object
          payload = JSON.stringify({ message: trimmed });
        }
      }
      const result = await testEventFlow(selectedEvent, payload);
      setTestResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsTesting(false);
    }
  }, [selectedEvent, payloadText]);

  const getPersona = (id: string | null) =>
    id ? personas.find((p) => p.id === id) : null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-6 max-w-xl">
        <div>
          <h3 className="typo-label text-foreground/80 mb-4">
            Publish Test Event
          </h3>
          <p className="text-sm text-foreground/70 mb-4">
            Fire a test event into the bus to verify subscriptions and agent routing.
            Pick a persona, choose one of its events, optionally add context, and publish.
          </p>
        </div>

        <div className="space-y-4">
          {/* Step 1: Persona selector */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-foreground/70 mb-1.5">
              1. Source Persona
            </label>
            <PersonaSelector
              value={selectedPersonaId}
              onChange={setSelectedPersonaId}
              personas={personas}
              showAll={false}
              placeholder="Pick a persona..."
            />
          </div>

          {/* Step 2: Event selector */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-foreground/70 mb-1.5">
              2. Event Type
            </label>
            {!selectedPersonaId ? (
              <div className="px-3 py-2.5 rounded-xl border border-primary/10 bg-secondary/10 text-sm text-foreground/40 italic">
                Select a persona first
              </div>
            ) : isLoadingEvents ? (
              <div className="px-3 py-2.5 rounded-xl border border-primary/10 bg-secondary/10 text-sm text-foreground/40 animate-pulse">
                Loading events...
              </div>
            ) : eventTypes.length === 0 ? (
              <div className="px-3 py-2.5 rounded-xl border border-amber-400/15 bg-amber-500/5 text-sm text-foreground/60">
                No events connected to this persona. Add event subscriptions or triggers first.
              </div>
            ) : (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setEventDropdownOpen(!eventDropdownOpen)}
                  className={`flex items-center gap-2 w-full px-3 py-2 rounded-xl border transition-all text-left ${
                    eventDropdownOpen
                      ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20'
                      : 'border-primary/15 bg-secondary/20 hover:border-primary/25 hover:bg-secondary/30'
                  }`}
                >
                  {selectedEvent ? (
                    <>
                      <Radio className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                      <span className="text-sm font-mono text-foreground/85 truncate flex-1">{selectedEvent}</span>
                    </>
                  ) : (
                    <span className="text-sm text-foreground/50 flex-1">Pick an event...</span>
                  )}
                  <ChevronDown className={`w-3.5 h-3.5 text-foreground/40 flex-shrink-0 transition-transform ${eventDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {eventDropdownOpen && (
                  <div className="animate-fade-slide-in absolute top-full left-0 mt-1 z-50 w-full max-h-[280px] rounded-xl border border-primary/15 bg-background shadow-xl shadow-black/20 overflow-y-auto py-1">
                    {eventTypes.map((et) => {
                      const active = selectedEvent === et;
                      return (
                        <button
                          key={et}
                          type="button"
                          onClick={() => {
                            setSelectedEvent(et);
                            setEventDropdownOpen(false);
                          }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                            active ? 'bg-primary/8 text-foreground/90' : 'text-foreground/70 hover:bg-secondary/30'
                          }`}
                        >
                          <Radio className="w-3.5 h-3.5 text-cyan-400/60 flex-shrink-0" />
                          <span className="text-sm font-mono truncate flex-1">{et}</span>
                          {active && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 3: Payload (plain text) */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-foreground/70 mb-1.5">
              3. Message <span className="font-normal text-foreground/40">(optional)</span>
            </label>
            <textarea
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              rows={3}
              placeholder="Describe context for the event... (plain text or JSON)"
              className="w-full px-3 py-2 text-sm rounded-xl border border-primary/15 bg-secondary/20 text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
            />
            <p className="text-[10px] text-foreground/40 mt-1">
              Plain text is wrapped as <code className="font-mono text-foreground/50">{"{ \"message\": \"...\" }"}</code> automatically. Valid JSON is sent as-is.
            </p>
          </div>

          {/* Publish button */}
          <button
            onClick={() => void handleTestFire()}
            disabled={isTesting || !selectedEvent.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-pulse' : ''}`} />
            {isTesting ? 'Publishing...' : 'Publish Event'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Result */}
        {testResult && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
            <p className="text-sm font-medium text-emerald-400">Event published</p>
            <div className="text-xs text-foreground/70 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-foreground/50 w-14 text-right">ID</span>
                <span className="font-mono">{testResult.id}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-foreground/50 w-14 text-right">Type</span>
                <span className="font-mono">{testResult.event_type}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-foreground/50 w-14 text-right">Status</span>
                <span className="font-mono">{testResult.status}</span>
              </div>
              {testResult.target_persona_id && (() => {
                const target = getPersona(testResult.target_persona_id);
                return (
                  <div className="flex items-center gap-2">
                    <span className="text-foreground/50 w-14 text-right">Target</span>
                    {target ? (
                      <span className="flex items-center gap-1.5">
                        <PersonaIcon icon={target.icon} color={target.color} frameSize="sm" />
                        <span>{target.name}</span>
                      </span>
                    ) : (
                      <span className="font-mono">{testResult.target_persona_id}</span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
