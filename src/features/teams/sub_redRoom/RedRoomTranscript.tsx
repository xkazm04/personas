import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { usePersonaIndex } from '../sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily, type RedRoomItem } from './useRedRoomFeed';

/**
 * TRANSCRIPT variant — "mission radio log".
 *
 * Metaphor: an air-traffic transcript. Dense monospace lines, one per
 * transmission: timestamp · CALLSIGN · event channel · message. Colour-coded
 * left rail per event family, family filter chips at the top, memories logged
 * as ★ NOTE lines. Built for operators who want maximum information density
 * and chronological scanning — the opposite of the Channel's conversational
 * reading.
 */

const FAMILIES = ['handoff', 'pr', 'qa', 'release', 'failure', 'build', 'other'] as const;

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
  other: 'text-foreground/60',
};

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

  const toggle = (f: string) =>
    setActiveFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const visible = useMemo(() => {
    const chronological = [...items].reverse();
    if (activeFamilies.size === 0) return chronological;
    return chronological.filter((i) =>
      i.kind === 'memory' ? true : activeFamilies.has(eventFamily(i.eventType)),
    );
  }, [items, activeFamilies]);

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="redroom-transcript">
      {/* Family filter chips */}
      <div className="flex items-center gap-1.5 pb-2 flex-shrink-0 flex-wrap">
        {FAMILIES.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => toggle(f)}
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

      {/* The log */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-card border border-primary/10 bg-background/60 font-mono">
        {visible.map((item) => {
          const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
          const sign = callsign(persona?.name);
          if (item.kind === 'memory') {
            return (
              <div key={`m-${item.id}`} className={`flex gap-2 px-3 py-1 border-l-2 ${FAMILY_RAIL.memory} hover:bg-secondary/20`}>
                <span className="typo-caption text-foreground/40 tabular-nums flex-shrink-0">{hhmmss(item.at)}</span>
                <span className="typo-caption text-amber-300/90 flex-shrink-0">★ NOTE</span>
                <span className="typo-caption text-foreground/55 flex-shrink-0">{sign}</span>
                <span className="typo-caption text-foreground/80 truncate" title={item.content}>
                  {item.title} — {item.content}
                </span>
              </div>
            );
          }
          const fam = eventFamily(item.eventType);
          return (
            <div key={`e-${item.id}`} className={`flex gap-2 px-3 py-1 border-l-2 ${FAMILY_RAIL[fam]} hover:bg-secondary/20`}>
              <span className="typo-caption text-foreground/40 tabular-nums flex-shrink-0">{hhmmss(item.at)}</span>
              <span className="typo-caption text-foreground font-semibold flex-shrink-0 w-28 truncate" title={sign}>{sign}</span>
              <span className={`typo-caption flex-shrink-0 ${FAMILY_TEXT[fam]}`}>{item.eventType}</span>
              <span className="typo-caption text-foreground/70 truncate" title={item.summary ?? undefined}>
                {item.errorMessage ? `✗ ${item.errorMessage}` : item.summary ?? ''}
              </span>
              {item.artifact && (
                <a
                  href={item.artifact.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto flex-shrink-0 inline-flex items-center gap-1 typo-caption text-foreground/60 hover:text-foreground"
                >
                  <ExternalLink className="w-3 h-3" /> {item.artifact.label}
                </a>
              )}
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="px-3 py-4 typo-caption text-foreground/45">No transmissions in this channel yet.</p>
        )}
      </div>
    </div>
  );
}

export default RedRoomTranscript;
