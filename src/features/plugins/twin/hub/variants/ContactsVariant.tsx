/**
 * Variant "contacts" — people first.
 *
 * The roster is a grid of person tokens, each carrying a 7-day activity
 * sparkline, its message count and when it was last seen. Selecting one turns
 * the roster into a rail and opens that person's LANE: everything the brain
 * attributes to them — their messages, the facts distilled from those messages
 * and the memories captured out of them — each with the same inline react
 * affordances every other variant offers, plus the reply lane scoped to them.
 *
 * The sparkline is derived from the feed's own `message` entries: `feed.contacts`
 * already carries the roster and the Hub loads the communications once, so no
 * tile issues a second query.
 *
 * An empty roster says why it is empty. It is not an onboarding pitch.
 */

import { useMemo, useState } from 'react';
import { ArrowLeft, Users } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import { HubEntryRow } from '../HubEntryRow';
import { ReplyLane } from '../ReplyLane';
import { ContactEditor, ContactToken } from './ContactToken';
import type { TwinContact } from '@/lib/bindings/TwinContact';
import type { HubVariantProps } from '../hubContract';

const SPARK_DAYS = 7;
const DAY_MS = 86_400_000;
/** Rows one lane reveals; beyond this the lane stops being a reading. */
const LANE_ROW_CAP = 40;

export default function ContactsVariant({ feed }: HubVariantProps) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.twin.hub.contacts;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edited, setEdited] = useState<Record<string, TwinContact>>({});
  const enter = useRevealTracker(selectedId ?? 'roster');

  const contacts = useMemo(
    () => feed.contacts.map((c) => edited[c.id] ?? c),
    [feed.contacts, edited],
  );

  /** handle → daily message bins, oldest first. One pass over the feed. */
  const bins = useMemo(() => {
    const map = new Map<string, number[]>();
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const cutoff = today - (SPARK_DAYS - 1) * DAY_MS;
    for (const e of feed.entries) {
      if (e.kind !== 'message' || !e.contactHandle) continue;
      const ms = Date.parse(e.at);
      if (Number.isNaN(ms) || ms < cutoff) continue;
      const key = e.contactHandle.trim().toLowerCase();
      const row = map.get(key) ?? new Array<number>(SPARK_DAYS).fill(0);
      const bin = Math.min(SPARK_DAYS - 1, Math.max(0, Math.floor((ms - cutoff) / DAY_MS)));
      row[bin] = (row[bin] ?? 0) + 1;
      map.set(key, row);
    }
    return map;
  }, [feed.entries]);

  const selected = contacts.find((c) => c.id === selectedId) ?? null;

  /** Their messages and facts by handle; their memories by the message each came from. */
  const lane = useMemo(() => {
    if (!selected) return [];
    const key = selected.handle.trim().toLowerCase();
    const mine = new Set(
      feed.entries.filter((e) => e.kind === 'message' && e.contactHandle?.trim().toLowerCase() === key)
        .map((e) => e.id),
    );
    return feed.entries.filter((e) => {
      if (e.contactHandle?.trim().toLowerCase() === key) return true;
      const from = e.source.kind === 'memory' ? e.source.row.source_communication_id : null;
      return !!from && mine.has(from);
    });
  }, [feed.entries, selected]);

  // `no-results` is the calm, no-CTA scenario — the roster being empty is a
  // fact about the conversation log, not a prompt to go set something up. Its
  // default SearchX glyph reads as "your filter matched nothing", so the icon
  // is overridden to say "people".
  const empty = <EmptyState variant="no-results" icon={Users} title={t.emptyTitle} subtitle={t.emptyBody} />;

  return (
    <div className="flex-1 min-h-0 flex flex-col xl:flex-row">
      {/* ── Roster ─────────────────────────────────────────────────── */}
      <div className={`min-h-0 overflow-y-auto px-4 md:px-6 xl:px-8 py-3 ${
        selected ? 'xl:w-[20rem] xl:flex-shrink-0 xl:border-r border-border' : 'flex-1'
      }`}>
        <p className="typo-label text-foreground mb-2 tabular-nums">
          {tx(t.rosterCount, { count: contacts.length })}
        </p>
        {feed.loading && contacts.length === 0 ? (
          <RosterGhost />
        ) : contacts.length === 0 ? (
          empty
        ) : (
          <ul className={`grid gap-2 ${
            selected ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
          }`}>
            {contacts.map((c, i) => (
              <ContactToken
                key={c.id}
                contact={c}
                order={i}
                enter={enter}
                bins={bins.get(c.handle.trim().toLowerCase()) ?? new Array<number>(SPARK_DAYS).fill(0)}
                selected={c.id === selectedId}
                onSelect={() => setSelectedId((cur) => (cur === c.id ? null : c.id))}
                sparkLabel={tx(t.sparkLabel, { days: SPARK_DAYS })}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── One person's lane ──────────────────────────────────────── */}
      {selected && (
        <section className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 xl:px-8 py-3 space-y-3">
          <header className="flex items-center gap-2 flex-wrap">
            <Button size="xs" variant="ghost" onClick={() => setSelectedId(null)}>
              <ArrowLeft className="w-3 h-3 mr-1" />
              {t.back}
            </Button>
            <span className="w-7 h-7 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
              <Users className="w-3.5 h-3.5 text-primary" />
            </span>
            <h2 className="typo-heading text-foreground truncate min-w-0">
              {selected.alias?.trim() ? selected.alias : selected.handle}
            </h2>
            {selected.alias?.trim() && (
              <span className="typo-caption text-foreground truncate">{selected.handle}</span>
            )}
            {selected.last_seen_at && (
              <RelativeTime timestamp={selected.last_seen_at} className="ml-auto typo-caption text-foreground tabular-nums" />
            )}
          </header>

          <ContactEditor contact={selected} onSaved={(u) => setEdited((p) => ({ ...p, [u.id]: u }))} />

          <ReplyLane contactHandle={selected.handle} />

          <div className="space-y-2">
            <p className="typo-label text-foreground tabular-nums">
              {tx(t.attributed, { count: lane.length })}
            </p>
            {lane.length === 0 ? (
              <p className="typo-caption text-foreground">{t.laneEmpty}</p>
            ) : (
              <ul className="space-y-1.5">
                {lane.slice(0, LANE_ROW_CAP).map((entry, i) => (
                  <HubEntryRow key={entry.id} entry={entry} feed={feed} order={i} enter={enter} />
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** Calm, geometry-matched ghost under the permanent roster count — never a spinner. */
function RosterGhost() {
  return (
    <ul className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li key={i} className="rounded-card border border-border bg-card/40 px-3 py-2.5 space-y-2 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}>
          <span className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary/[0.06] flex-shrink-0" />
            <span className="block h-3 flex-1 rounded bg-primary/[0.06]" />
          </span>
          <span className="block h-3 w-1/2 rounded bg-primary/[0.06]" />
        </li>
      ))}
    </ul>
  );
}
