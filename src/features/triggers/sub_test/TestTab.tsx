import { useEffect, useMemo, useRef, useState } from 'react';
import { Info, RotateCcw, Sparkles, Zap } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { listAllSubscriptions, listEvents, testEventFlow } from '@/api/overview/events';
import type { PersonaEvent } from '@/lib/types/types';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaSelector } from '@/features/shared/components/forms/PersonaSelector';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { findTemplateByEventType } from '../sub_builder/libs/eventCanvasConstants';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { silentCatch } from '@/lib/silentCatch';


const FALLBACK_PAYLOAD = '{}';
const CUSTOM_EVENT_VALUE = '__custom__';

export function TestTab() {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);

  const [recentEvents, setRecentEvents] = useState<PersonaEvent[]>([]);
  const [subscriptions, setSubscriptions] = useState<PersonaEventSubscription[]>([]);

  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [selectedEventType, setSelectedEventType] = useState<string>('');
  const [customEventType, setCustomEventType] = useState<string>('');
  const [payload, setPayload] = useState<string>(FALLBACK_PAYLOAD);
  const [payloadSource, setPayloadSource] = useState<'history' | 'fallback'>('fallback');
  const [historyEvent, setHistoryEvent] = useState<PersonaEvent | null>(null);

  const [testResult, setTestResult] = useState<PersonaEvent | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Load recent events + subscriptions once. Subsequent test fires append locally.
  useEffect(() => {
    let stale = false;
    Promise.all([
      listEvents(500).catch(() => [] as PersonaEvent[]),
      listAllSubscriptions().catch(() => [] as PersonaEventSubscription[]),
    ]).then(([events, subs]) => {
      if (stale) return;
      setRecentEvents(events);
      setSubscriptions(subs);
    });
    return () => { stale = true; };
  }, []);

  const personaIdSet = useMemo(() => new Set(personas.map(p => p.id)), [personas]);

  // persona ID → event types this persona emits, derived from the same heuristic
  // the routing view uses (recent events + emitter-direction subscriptions).
  const eventTypesByPersona = useMemo(() => {
    const map = new Map<string, Set<string>>();

    const emittersByEventType = new Map<string, Set<string>>();
    for (const evt of recentEvents) {
      if (!evt.source_id || !personaIdSet.has(evt.source_id)) continue;
      const set = map.get(evt.source_id) ?? new Set<string>();
      set.add(evt.event_type);
      map.set(evt.source_id, set);
      const ems = emittersByEventType.get(evt.event_type) ?? new Set<string>();
      ems.add(evt.source_id);
      emittersByEventType.set(evt.event_type, ems);
    }

    for (const sub of subscriptions) {
      const isCatalogListener = !!findTemplateByEventType(sub.event_type);
      if (isCatalogListener) continue;
      const emitters = emittersByEventType.get(sub.event_type);
      const direction: 'emitter' | 'listener' =
        emitters?.has(sub.persona_id) ? 'emitter'
        : emitters && emitters.size > 0 ? 'listener'
        : 'emitter';
      if (direction !== 'emitter') continue;
      const set = map.get(sub.persona_id) ?? new Set<string>();
      set.add(sub.event_type);
      map.set(sub.persona_id, set);
    }

    return map;
  }, [recentEvents, subscriptions, personaIdSet]);

  // Default-pick the persona that pushed the most recent event in the system,
  // so the form opens with a useful state. Runs once after first load.
  const didAutoPickRef = useRef(false);
  useEffect(() => {
    if (didAutoPickRef.current) return;
    if (recentEvents.length === 0 || personas.length === 0) return;

    const primary = recentEvents
      .filter(e => e.source_id && personaIdSet.has(e.source_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

    if (primary?.source_id) {
      setSelectedPersonaId(primary.source_id);
      setSelectedEventType(primary.event_type);
    }
    didAutoPickRef.current = true;
  }, [recentEvents, personas, personaIdSet]);

  const eventOptions = useMemo<ThemedSelectOption[]>(() => {
    if (!selectedPersonaId) return [];
    const types = eventTypesByPersona.get(selectedPersonaId) ?? new Set<string>();
    const sorted = Array.from(types).sort();
    const opts: ThemedSelectOption[] = sorted.map(et => {
      const tmpl = findTemplateByEventType(et);
      return { value: et, label: tmpl ? `${tmpl.label} · ${et}` : et };
    });
    opts.push({ value: CUSTOM_EVENT_VALUE, label: t.triggers.test_custom_event_option });
    return opts;
  }, [selectedPersonaId, eventTypesByPersona, t]);

  // Resolve the active event type the user actually wants to publish.
  const activeEventType = selectedEventType === CUSTOM_EVENT_VALUE
    ? customEventType.trim()
    : selectedEventType;

  // Find the most recent event from this persona for this event type — the
  // "primary source last pushed event" — and use its payload as the prefill.
  const refreshPrefill = (personaId: string, eventType: string) => {
    if (!personaId || !eventType) {
      setHistoryEvent(null);
      setPayload(FALLBACK_PAYLOAD);
      setPayloadSource('fallback');
      return;
    }
    const last = recentEvents
      .filter(e => e.source_id === personaId && e.event_type === eventType)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

    setHistoryEvent(last);

    if (last && last.payload) {
      try {
        setPayload(JSON.stringify(JSON.parse(last.payload), null, 2));
      } catch {
        setPayload(last.payload);
      }
      setPayloadSource('history');
    } else {
      setPayload(FALLBACK_PAYLOAD);
      setPayloadSource('fallback');
    }
  };

  // Re-run prefill whenever the (persona, event) tuple changes, including
  // when recent events finish loading and the auto-pick lands.
  useEffect(() => {
    refreshPrefill(selectedPersonaId, activeEventType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPersonaId, activeEventType, recentEvents]);

  const handlePersonaChange = (id: string) => {
    setSelectedPersonaId(id);
    setSelectedEventType('');
    setCustomEventType('');
    setTestResult(null);
  };

  const handleEventChange = (et: string) => {
    setSelectedEventType(et);
    setCustomEventType('');
    setTestResult(null);
  };

  const getPersona = (id: string | null) => (id ? personas.find(p => p.id === id) : null);

  const eventOptionsAvailable = eventOptions.length > 1; // 1 = always-present custom row
  const hasPersona = !!selectedPersonaId;
  const isCustomPicked = selectedEventType === CUSTOM_EVENT_VALUE;

  // Validate JSON. Invalid payload BLOCKS submit — previously the textarea
  // showed an amber hint but the button was still active, and `handleTestFire`
  // dropped the payload (`normalised = undefined`) on parse failure. Users
  // saw a green "event published" with empty input and blamed their persona
  // logic for not handling input it never received. The hint stays visible
  // so the cause is obvious; the test fire is only enabled once it parses.
  const isInvalidJson = useMemo(() => {
    if (!payload.trim()) return false;
    try { JSON.parse(payload); return false; } catch { return true; }
  }, [payload]);

  const canFire = !!activeEventType && hasPersona && !isTesting && !isInvalidJson;

  const handleTestFire = async () => {
    if (!activeEventType) return;
    // Defense in depth: the disabled `canFire` check prevents this in practice,
    // but keyboard "Enter" inside the textarea or other corner cases could still
    // route here. Refuse to silently drop the payload.
    if (isInvalidJson) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      // Empty textarea → omit payload entirely. Otherwise send the normalized
      // (re-stringified) JSON so the backend sees canonical form.
      const normalised = payload.trim()
        ? JSON.stringify(JSON.parse(payload))
        : undefined;
      const result = await testEventFlow(activeEventType, normalised);
      setTestResult(result);
      // Append the new event so the next prefill refresh sees it as history.
      setRecentEvents(prev => [result, ...prev]);
    } catch (err) { silentCatch("features/triggers/sub_test/TestTab:catch1")(err); } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-6 max-w-2xl">
        <div>
          <h3 className="typo-code font-mono text-foreground uppercase tracking-wider mb-2">
            {t.triggers.publish_test_event}
          </h3>
          <p className="typo-body text-foreground">
            {t.triggers.publish_test_desc}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block typo-caption font-medium text-foreground mb-1.5">
              {t.triggers.test_source_persona_label}
            </label>
            <PersonaSelector
              value={selectedPersonaId}
              onChange={handlePersonaChange}
              personas={personas}
              showAll={false}
              placeholder={t.triggers.test_select_persona_placeholder}
            />
            <p className="typo-caption text-foreground mt-1">{t.triggers.test_source_persona_help}</p>
          </div>

          <div>
            <label className="block typo-caption font-medium text-foreground mb-1.5">
              {t.triggers.test_output_event_label}
            </label>
            <ThemedSelect
              filterable
              options={eventOptions}
              value={selectedEventType}
              onValueChange={handleEventChange}
              placeholder={t.triggers.test_select_event_placeholder}
              wrapperClassName={`w-full ${hasPersona ? '' : 'opacity-50 pointer-events-none'}`}
            />
            <p className="typo-caption text-foreground mt-1">{t.triggers.test_output_event_help}</p>
            {hasPersona && !eventOptionsAvailable && (
              <p className="typo-caption text-amber-400/90 mt-1.5 flex items-start gap-1.5">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>{t.triggers.test_no_emitted_events}</span>
              </p>
            )}
          </div>

          {isCustomPicked && (
            <div>
              <label className="block typo-caption font-medium text-foreground mb-1.5">
                {t.triggers.test_custom_event_label}
              </label>
              <input
                type="text"
                value={customEventType}
                onChange={(e) => setCustomEventType(e.target.value)}
                placeholder={t.triggers.test_event_type_placeholder}
                className="w-full px-3 py-2 typo-body rounded-card border border-border/40 bg-secondary/30 text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="typo-caption font-medium text-foreground">{t.triggers.payload_json_label}</label>
              {payloadSource === 'history' && historyEvent && (
                <button
                  type="button"
                  onClick={() => refreshPrefill(selectedPersonaId, activeEventType)}
                  className="flex items-center gap-1 typo-caption text-foreground hover:text-foreground transition-colors"
                  title={t.triggers.test_payload_reset}
                >
                  <RotateCcw className="w-3 h-3" />
                  {t.triggers.test_payload_reset}
                </button>
              )}
            </div>
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 typo-code rounded-card border border-border/40 bg-secondary/30 text-foreground font-mono placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-y"
            />
            <div className="mt-1.5 typo-caption flex items-start gap-1.5">
              {payloadSource === 'history' && historyEvent ? (
                <span className="text-emerald-400 flex items-start gap-1.5">
                  <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  {tx(t.triggers.test_payload_from_history, { ago: formatRelativeTime(historyEvent.created_at) })}
                </span>
              ) : (
                <span className="text-foreground flex items-start gap-1.5">
                  <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  {t.triggers.test_payload_no_history}
                </span>
              )}
            </div>
            {isInvalidJson && (
              <p className="typo-caption text-amber-400/90 mt-1">{t.triggers.test_payload_invalid_json}</p>
            )}
          </div>

          <button
            onClick={handleTestFire}
            disabled={!canFire}
            className="flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-card bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-pulse' : ''}`} />
            {isTesting ? t.triggers.publishing_label : t.triggers.publish_event}
          </button>
        </div>

        {testResult && (
          <div className="rounded-card border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
            <p className="typo-body font-medium text-emerald-400">{t.triggers.event_published}</p>
            <div className="typo-code text-foreground space-y-1 font-mono">
              <p>{t.triggers.result_id_prefix} {testResult.id}</p>
              <p>{t.triggers.result_type_prefix} {testResult.event_type}</p>
              <p>{t.triggers.result_status_prefix} {testResult.status}</p>
              {testResult.target_persona_id && (
                <p>{t.triggers.result_target_prefix} {getPersona(testResult.target_persona_id)?.name ?? testResult.target_persona_id}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
