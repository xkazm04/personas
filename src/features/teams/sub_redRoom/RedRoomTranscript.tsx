import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';
import { usePersonaIndex } from '../sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily, memberColor, type RedRoomItem } from './useRedRoomFeed';
import { RedRoomDetailModal } from './RedRoomDetailModal';

/**
 * TRANSCRIPT variant — "mission radio log".
 *
 * Metaphor: an air-traffic transcript. Dense monospace lines, one per
 * transmission (newest first): timestamp · CALLSIGN · event channel ·
 * message. Callsigns carry each member's universal colour (the persona's own
 * hue, same as roster dots / canvas nodes). Filterable by event family AND by
 * member; any row opens the full transmission in a modal. History loads in
 * batches of 20 with an entry animation as you scroll.
 */

const FAMILIES = ['handoff', 'pr', 'qa', 'release', 'failure', 'build', 'note', 'other'] as const;

const FAMILY_RAIL: Record<string, string> = {
  handoff: 'border-l-violet-400/70',
  pr: 'border-l-blue-400/70',
  qa: 'border-l-amber-400/70',
  release: 'border-l-emerald-400/70',
  failure: 'border-l-red-400/70',
  build: 'border-l-sky-400/70',
  other: 'border-l-foreground/25',
  memory: 'border-l-amber-300/60',
};

const FAMILY_TEXT: Record<string, string> = {
  handoff: 'text-violet-300',
  pr: 'text-blue-300',
  qa: 'text-amber-300',
  release: 'text-emerald-300',
  failure: 'text-red-300',
  build: 'text-sky-300',
  note: 'text-amber-200/90',
  other: 'text-foreground/60',
};

const BATCH_SIZE = 20;

function hhmmss(at: number): string {
  const d = new Date(at);
  return d.toTimeString().slice(0, 8);
}

/** Uppercase short callsign from a persona name ("T: QA Guardian" → "QA-GUARDIAN"). */
function callsign(name: string | undefined): string {
  if (!name) return 'SYSTEM';
  return name.replace(/^T: /, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 14);
}

export function RedRoomTranscript({ items }: { items: RedRoomItem[] }) {
  const personaIndex = usePersonaIndex();
  const [activeFamilies, setActiveFamilies] = useState<Set<string>>(new Set());
  const [activeMembers, setActiveMembers] = useState<Set<string>>(new Set());
  const [openItem, setOpenItem] = useState<RedRoomItem | null>(null);
  const [batches, setBatches] = useState(1);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const toggleIn = (set: React.Dispatch<React.SetStateAction<Set<string>>>) => (key: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleFamily = toggleIn(setActiveFamilies);
  const toggleMember = toggleIn(setActiveMembers);

  // Distinct speakers actually present in the log, ordered by activity.
  const speakers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) {
      if (i.personaId) counts.set(i.personaId, (counts.get(i.personaId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([pid]) => pid);
  }, [items]);

  // Newest-first; filters compose (family AND member).
  const filtered = useMemo(
    () =>
      items.filter((i) => {
        const family = i.kind === 'memory' ? 'note' : eventFamily(i.eventType);
        if (activeFamilies.size > 0 && !activeFamilies.has(family)) return false;
        if (activeMembers.size > 0 && (!i.personaId || !activeMembers.has(i.personaId))) return false;
        return true;
      }),
    [items, activeFamilies, activeMembers],
  );

  // Filters changed → restart the window.
  useEffect(() => {
    setBatches(1);
  }, [activeFamilies, activeMembers]);

  const visible = useMemo(() => filtered.slice(0, batches * BATCH_SIZE), [filtered, batches]);
  const hasMore = visible.length < filtered.length;

  // Infinite load — grow the window when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setBatches((b) => b + 1);
      },
      { rootMargin: '120px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, visible.length]);

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="redroom-transcript">
      {/* Filters: event families + members */}
      <div className="flex items-center gap-1.5 pb-1.5 flex-shrink-0 flex-wrap">
        {FAMILIES.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => toggleFamily(f)}
            aria-pressed={activeFamilies.has(f)}
            className={`px-2 py-0.5 rounded-interactive border typo-caption font-mono uppercase tracking-wider transition-colors ${
              activeFamilies.size === 0 || activeFamilies.has(f)
                ? `border-primary/20 bg-secondary/40 ${FAMILY_TEXT[f]}`
                : 'border-primary/10 text-foreground/35 hover:text-foreground/60'
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      {speakers.length > 0 && (
        <div className="flex items-center gap-1.5 pb-2 flex-shrink-0 flex-wrap" data-testid="transcript-member-filter">
          {speakers.map((pid) => {
            const persona = personaIndex.get(pid);
            const color = memberColor(persona, pid);
            const on = activeMembers.size === 0 || activeMembers.has(pid);
            return (
              <button
                key={pid}
                type="button"
                onClick={() => toggleMember(pid)}
                aria-pressed={activeMembers.has(pid)}
                title={persona?.name.replace(/^T: /, '') ?? pid}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-interactive border typo-caption font-mono transition-colors ${
                  on ? 'border-primary/20 bg-secondary/40' : 'border-primary/10 hover:bg-secondary/25'
                }`}
                style={{ color: on ? color : undefined, opacity: on ? 1 : 0.45 }}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                {callsign(persona?.name)}
              </button>
            );
          })}
        </div>
      )}

      {/* The log — newest first, batched infinite load */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-card border border-primary/10 bg-background/60 font-mono">
        {visible.map((item, idx) => {
          const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
          const sign = callsign(persona?.name);
          const color = memberColor(persona, item.personaId);
          // Only freshly-mounted rows animate (stable keys keep old rows still);
          // stagger within the latest batch only.
          const delay = (idx % BATCH_SIZE) * 0.015;
          if (item.kind === 'memory') {
            return (
              <motion.button
                key={`m-${item.id}`}
                type="button"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay }}
                onClick={() => setOpenItem(item)}
                className={`w-full text-left flex gap-2 px-3 py-1 border-l-2 ${FAMILY_RAIL.memory} hover:bg-secondary/25 cursor-pointer`}
              >
                <span className="typo-caption text-foreground/40 tabular-nums flex-shrink-0">{hhmmss(item.at)}</span>
                <span className="typo-caption text-amber-300/90 flex-shrink-0">★ NOTE</span>
                <span className="typo-caption flex-shrink-0" style={{ color }}>{sign}</span>
                <span className="typo-caption text-foreground/80 truncate">
                  {item.title} — {item.content}
                </span>
              </motion.button>
            );
          }
          const fam = eventFamily(item.eventType);
          return (
            <motion.button
              key={`e-${item.id}`}
              type="button"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay }}
              onClick={() => setOpenItem(item)}
              className={`w-full text-left flex gap-2 px-3 py-1 border-l-2 ${FAMILY_RAIL[fam]} hover:bg-secondary/25 cursor-pointer`}
            >
              <span className="typo-caption text-foreground/40 tabular-nums flex-shrink-0">{hhmmss(item.at)}</span>
              <span className="typo-caption font-semibold flex-shrink-0 w-28 truncate" style={{ color }} title={sign}>{sign}</span>
              <span className={`typo-caption flex-shrink-0 ${FAMILY_TEXT[fam]}`}>{item.eventType}</span>
              <span className="typo-caption text-foreground/70 truncate" title={item.summary ?? undefined}>
                {item.errorMessage ? `✗ ${item.errorMessage}` : item.summary ?? ''}
              </span>
              {item.artifact && (
                <span className="ml-auto flex-shrink-0 inline-flex items-center gap-1 typo-caption text-foreground/60">
                  <ExternalLink className="w-3 h-3" /> {item.artifact.label}
                </span>
              )}
            </motion.button>
          );
        })}
        {visible.length === 0 && (
          <p className="px-3 py-4 typo-caption text-foreground/45">No transmissions in this channel yet.</p>
        )}
        {/* Infinite-load sentinel */}
        {hasMore && (
          <div ref={sentinelRef} className="px-3 py-2">
            <p className="typo-caption text-foreground/40">Loading older transmissions…</p>
          </div>
        )}
      </div>

      <RedRoomDetailModal item={openItem} onClose={() => setOpenItem(null)} />
    </div>
  );
}

export default RedRoomTranscript;
