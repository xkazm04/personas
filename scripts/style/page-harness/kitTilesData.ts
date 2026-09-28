/**
 * Data for `kit/tiles-a|b` (kitTiles.tsx), read straight off the tape the shooter injects: the
 * H0 composed-a Cockpit tape (homeCockpitTapes.mjs, read-only here) plus the briefing, chat-card
 * and council-seat seeds that synthetic-tapes.mjs merges into this view's `__harness_seed`.
 * Harness-only; the shapes are the tape's own (see homeCockpitTapes.mjs).
 */
import type { Tone } from '@/features/shared/components/kit';

type Row = Record<string, unknown>;
type Widget = { id: string; kind: string; title?: string; span?: number; config: Row; actions?: Row[] };

function calls(): Array<{ cmd: string; response?: unknown }> {
  return window.__PAGE_HARNESS_TAPE__?.calls ?? [];
}

function answer<T>(cmd: string, fallback: T): T {
  // The tape's own response for `cmd`; the tape shapes are authored in homeCockpitTapes.mjs.
  return (calls().find((c) => c.cmd === cmd)?.response as T | undefined) ?? fallback;
}

/** Relative age at the tape's frozen clock: 40m, 3h, 2d. */
export function age(iso: unknown): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(String(iso))) / 60_000));
  return m < 60 ? `${m}m` : m < 60 * 24 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

/** A widget intent or severity as a kit tone. */
export function toneOf(v: unknown): Tone {
  const s = String(v);
  if (s === 'bad' || s === 'critical' || s === 'high') return 'error';
  if (s === 'warn' || s === 'medium' || s === 'med') return 'warning';
  if (s === 'good') return 'success';
  return 'info';
}

export function tilesData() {
  const cockpit = answer<{ specJson?: string }>('companion_get_cockpit', {});
  const spec = JSON.parse(cockpit.specJson ?? '{"title":"","widgets":[]}') as { title: string; widgets: Widget[] };
  const w = (id: string) => spec.widgets.find((x) => x.id === id)?.config ?? {};
  const seed = answer<Row>('__harness_seed', {});
  const inbox = (seed.inbox ?? {}) as { manualReviews?: Row[]; reports?: Row[]; healingIssues?: Row[] };
  const decisions: Row[] = [
    ...(inbox.manualReviews ?? []).map((r): Row => ({ ...r, kind: 'Approval' })),
    ...(inbox.reports ?? []).map((r): Row => ({ ...r, kind: 'Message', severity: r.priority === 'high' ? 'high' : 'info' })),
    ...(inbox.healingIssues ?? []).map((r): Row => ({ ...r, kind: 'Issue' })),
  ].sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)));
  const briefing = ((seed.briefing as { spec?: { widgets: Widget[] } } | undefined)?.spec?.widgets ?? []);
  const chat = (seed.chatCards ?? []) as Array<{ kind: string; title?: string; config: Row }>;
  const seat = (seed.seat ?? {}) as { findings?: Row[]; evidence?: Row[] };
  return {
    title: spec.title,
    callout: { title: spec.widgets.find((x) => x.id === 'a-lead')?.title ?? '', body: String(w('a-lead').body ?? '') },
    metrics: ['a-k1', 'a-k2', 'a-k3'].map((id) => w(id)),
    vitals: (w('a-stats').stats ?? []) as Row[],
    personas: answer<Row[]>('list_personas', []),
    decisions: { rows: decisions.slice(0, 25), total: decisions.length },
    services: answer<Row[]>('list_credentials', []).slice(0, 12),
    issues: (w('a-issues').items ?? []) as Row[],
    timeline: (w('a-timeline').events ?? []) as Row[],
    metricsSummary: answer<Row>('get_metrics_summary', {}),
    broke: briefing.find((x) => x.id === 'br-broken'),
    waiting: briefing.find((x) => x.id === 'br-verdict'),
    chat,
    seat,
  };
}
