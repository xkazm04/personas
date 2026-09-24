import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { interpolate, useTranslation } from '@/i18n/useTranslation';
import { listEventsInRange } from '@/api/overview/events';
import type { EventVocabularyEntry } from '@/lib/bindings/EventVocabularyEntry';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { silentCatch } from '@/lib/silentCatch';
import {
  classifyPatterns,
  parseEventTypes,
  previewMatches,
  type MatchableEvent,
} from '../libs/webhookMatch';

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 500;
// get_in_range is ASCENDING, so a single page would be the OLDEST events of
// the window. Walk the (created_at) cursor a bounded number of pages instead.
const MAX_PAGES = 4;

interface RecentEvents {
  events: MatchableEvent[];
  truncated: boolean;
}

async function loadRecentEvents(): Promise<RecentEvents> {
  const until = new Date().toISOString();
  let since = new Date(Date.now() - WINDOW_MS).toISOString();
  const byId = new Map<string, MatchableEvent>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listEventsInRange(since, until, PAGE_SIZE);
    for (const e of res.events) byId.set(e.id, { event_type: e.event_type, created_at: e.created_at });
    const last = res.events[res.events.length - 1];
    if (!res.has_more || !last) return { events: [...byId.values()], truncated: false };
    since = last.created_at;
  }
  return { events: [...byId.values()], truncated: true };
}

interface WebhookEventPickerProps {
  /** Raw comma separated pattern list (the draft's `eventTypes`). */
  value: string;
  onChange: (next: string) => void;
  /** Known vocabulary (curated seed + observed); null while loading or unavailable. */
  vocabulary: EventVocabularyEntry[] | null;
}

const CHIP = 'inline-flex items-center gap-1 rounded-interactive border px-2 py-0.5 typo-caption font-mono';

export function WebhookEventPicker({ value, onChange, vocabulary }: WebhookEventPickerProps) {
  const { t } = useTranslation();
  const s = t.settings.notifications;
  const [recent, setRecent] = useState<RecentEvents | null>(null);
  const [failed, setFailed] = useState(false);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    let live = true;
    loadRecentEvents()
      .then((r) => { if (live) setRecent(r); })
      .catch((err) => {
        silentCatch('features/settings/sub_notifications/components/WebhookEventPicker:recent')(err);
        if (live) setFailed(true);
      });
    return () => { live = false; };
  }, []);

  const patterns = useMemo(() => parseEventTypes(value), [value]);
  const verdicts = useMemo(
    () => (vocabulary ? classifyPatterns(patterns, vocabulary) : []),
    [patterns, vocabulary],
  );
  const preview = useMemo(() => (recent ? previewMatches(patterns, recent.events) : null), [patterns, recent]);
  const weekly = useMemo(() => (recent ? previewMatches(['*'], recent.events).byType : null), [recent]);
  // Events of a type in the loaded 7-day window. Absent from a LOADED tally is
  // a real zero; before the window loads (or when it failed) it is unknown: null.
  const weeklyCount = useCallback(
    (type: string): number | null => {
      if (!weekly) return null;
      const n = weekly[type];
      return n === undefined ? 0 : n;
    },
    [weekly],
  );
  const choices = useMemo(
    () =>
      (vocabulary ?? [])
        .filter((v) => !patterns.includes(v.eventType))
        .sort(
          (a, b) =>
            (weeklyCount(b.eventType) ?? 0) - (weeklyCount(a.eventType) ?? 0) ||
            Number(b.source === 'observed') - Number(a.source === 'observed') ||
            a.eventType.localeCompare(b.eventType),
        ),
    [vocabulary, patterns, weeklyCount],
  );

  const setPatterns = (next: string[]) => onChange([...new Set(next)].join(', '));
  const addCustom = () => {
    const parts = parseEventTypes(custom);
    if (parts.length === 0) return;
    setPatterns([...patterns, ...parts]);
    setCustom('');
  };
  const unknownOf = (p: string) => verdicts.find((v) => v.pattern === p && v.status === 'unknown');

  return (
    <div className="mt-1 space-y-2" data-testid="webhook-event-picker">
      {patterns.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {patterns.map((p) => (
            <span
              key={p}
              className={`${CHIP} ${unknownOf(p) ? 'border-status-warning/40 bg-status-warning/10 text-status-warning' : 'border-primary/25 bg-primary/10 text-foreground'}`}
            >
              {unknownOf(p) && <AlertTriangle className="w-3 h-3" />}
              {p}
              <button
                type="button"
                onClick={() => setPatterns(patterns.filter((x) => x !== p))}
                aria-label={interpolate(s.webhook_events_remove_aria, { pattern: p })}
                className="rounded-interactive hover:bg-primary/15"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {verdicts.filter((v) => v.status === 'unknown').map(({ pattern, suggestion }) => (
        <div key={pattern} className="typo-caption text-status-warning flex flex-wrap items-center gap-1.5">
          <span>{interpolate(s.webhook_pattern_unknown, { pattern })}</span>
          {suggestion && (
            <button
              type="button"
              onClick={() => setPatterns(patterns.map((x) => (x === pattern ? suggestion : x)))}
              className="rounded-interactive px-1.5 underline underline-offset-2 hover:bg-status-warning/10"
            >
              {interpolate(s.webhook_pattern_suggest, { suggestion })}
            </button>
          )}
        </div>
      ))}
      <WebhookPreviewLine preview={preview} failed={failed} truncated={recent?.truncated ?? false} />
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
          className="w-full rounded-input border border-primary/15 bg-secondary/40 px-2 py-1 typo-body text-foreground font-mono"
          placeholder={s.webhook_events_custom_placeholder}
          data-testid="webhook-draft-custom-pattern"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={parseEventTypes(custom).length === 0}
          className="inline-flex items-center gap-1 rounded-interactive px-2 py-1 typo-caption text-foreground hover:bg-primary/10 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
          {s.webhook_events_add}
        </button>
      </div>
      <span className="typo-caption text-foreground block">{s.webhook_subscriptions_events_hint}</span>
      {choices.length > 0 && (
        <div>
          <span className="typo-caption text-foreground">{s.webhook_events_known}</span>
          <div className="mt-1 max-h-40 overflow-y-auto flex flex-wrap gap-1.5">
            {choices.map((v) => (
              <button
                key={v.eventType}
                type="button"
                onClick={() => setPatterns([...patterns, v.eventType])}
                className={`${CHIP} border-primary/15 bg-secondary/40 text-foreground hover:bg-primary/10`}
              >
                <Plus className="w-3 h-3 text-primary/60" />
                {v.eventType}
                <span className="font-sans text-foreground">
                  {v.source === 'observed' ? s.webhook_events_source_observed : s.webhook_events_source_builtin}
                  {weeklyCount(v.eventType) ? ` · ${interpolate(s.webhook_events_count_7d, { count: weeklyCount(v.eventType) ?? '' })}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface PreviewLineProps {
  preview: ReturnType<typeof previewMatches> | null;
  failed: boolean;
  truncated: boolean;
}

function WebhookPreviewLine({ preview, failed, truncated }: PreviewLineProps) {
  const { t } = useTranslation();
  const s = t.settings.notifications;
  if (preview?.empty) return <p className="typo-caption text-foreground">{s.webhook_preview_empty}</p>;
  if (failed) return <p className="typo-caption text-foreground">{s.webhook_preview_unavailable}</p>;
  if (!preview) return <span aria-hidden="true" className="block h-3 w-56 rounded-interactive bg-primary/[0.06]" />;
  return (
    <div className="typo-caption space-y-0.5" data-testid="webhook-draft-preview">
      {preview.count > 0 ? (
        <p className="text-status-success">
          {interpolate(s.webhook_preview_fired, {
            count: truncated ? `${preview.count}+` : preview.count,
            type: preview.lastType ?? '',
          })}{' '}
          <RelativeTime timestamp={preview.lastAt} />
        </p>
      ) : (
        <p className="text-status-warning">{s.webhook_preview_none}</p>
      )}
      {preview.separatorMisses.slice(0, 3).map((m) => (
        <p key={`${m.pattern}:${m.eventType}`} className="text-status-warning">
          {interpolate(s.webhook_preview_separator_miss, { pattern: m.pattern, type: m.eventType })}
        </p>
      ))}
    </div>
  );
}
