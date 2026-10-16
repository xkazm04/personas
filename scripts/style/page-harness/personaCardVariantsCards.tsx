/**
 * Three persona cards for the bays (WP11 phase A), each a different STRUCTURE
 * over the same facts (`personaCardVariantsFacts.tsx`). All three speak the
 * plate language of entry E: state is a lamp (`parts.tsx` Lamp) plus a tone
 * edge (`.ae-line.is-lit` / `.ae-win.is-lit`, entryE.css), never a fill.
 *
 *   V1 Tail        one 36px row in the bay nameplate's grammar: face, name, the
 *                  activity as a caption tail, figure + lamp at the right edge
 *   V2 Gutter      a 50px window (the session card's height): a lamp gutter,
 *                  face, name + figure, then the activity line with the next
 *                  start right-aligned
 *   V3 Instrument  a flat 58px row: lamp + name + state word, three aligned
 *                  figure columns (now/last, runs today, next), and a 3px foot
 *                  that is the run's age while it works and the last six
 *                  outcomes otherwise
 */
import { Activity, BarChart3, CalendarClock, Hourglass, PowerOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { NeedGlyph } from '@/features/fleet/monitor/grid/skin/NeedGlyph';
import { runAgeFraction } from '@/features/fleet/monitor/grid/skin/tileState';
import { Lamp } from '@/features/fleet/monitor/grid/prototype/entry-e/parts';
import { toneClass, type Tone } from '@/features/fleet/monitor/grid/prototype/entry-e/tone';
import { DeviceGlyph } from '@/features/fleet/monitor/grid/prototype/entry-e/devices/DeviceGlyph';
import { PeerAgentToggle } from '@/features/fleet/monitor/grid/prototype/entry-e/devices/PeerAgentToggle';
import { useCardFacts, type CardFacts, type LineProps } from './personaCardVariantsFacts';

const lit = (f: CardFacts) => f.kind === 'critical' || f.kind === 'warning';
const ink = (f: CardFacts) => (lit(f) ? 'ae-tone-text' : 'text-foreground');

function Face({ p, size = 'sm' }: { p: LineProps; size?: 'xs' | 'sm' }) {
  return <PersonaIcon icon={p.card.personaIcon} color={p.card.personaColor} name={p.card.personaName} display="framed" frameSize={size} frameClass="fb-face" />;
}

/** The activity sentence: why it needs you, else what it is doing, else its last run. */
function useActivity(f: CardFacts): { icon: ReactNode; text: string; tone: string } {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  // A peer's bay already says "On <device>"; its snapshot carries only running / enabled.
  if (f.device) return { icon: null, text: f.kind === 'working' ? m.grid_state_running : f.kind === 'off' ? m.board_pile_off : m.board_pile_resting, tone: f.kind === 'working' ? 'ae-tone-text' : 'text-foreground' };
  if (f.reason) return { icon: null, text: f.reason.word, tone: ink(f) };
  if (f.kind === 'off') return { icon: <PowerOff className="h-3 w-3 flex-shrink-0" aria-hidden />, text: m.board_pile_off, tone: 'text-foreground' };
  if (f.running) {
    const q = f.running.queued > 0 ? ` · ${tx(m.caption_queued_many, { count: f.running.queued })}` : '';
    return { icon: <Activity className="h-3 w-3 flex-shrink-0" aria-hidden />, text: `${m.grid_state_running}${q}`, tone: 'ae-tone-text' };
  }
  if (f.last) {
    const L = f.last.Icon;
    return { icon: <L className={`h-3 w-3 flex-shrink-0 ${f.last.ink}`} aria-hidden />, text: f.last.age ? tx(m.schedule_last_run, { when: f.last.age }) : m.board_reason_failed, tone: 'text-foreground' };
  }
  return { icon: null, text: m.board_no_runs, tone: 'text-foreground' };
}

function Next({ f }: { f: CardFacts }) {
  if (!f.next) return null;
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1 typo-caption tabular-nums text-foreground">
      <CalendarClock className="h-3 w-3" aria-hidden />{f.next}
    </span>
  );
}

/** The right edge: a peer's switch, else the figure that matters (count or elapsed). */
function Figure({ p, f }: { p: LineProps; f: CardFacts }) {
  if (p.peer) return <><DeviceGlyph peerId={p.peer.peerId} name={p.peer.device} /><PeerAgentToggle peerId={p.peer.peerId} device={p.peer.device} agent={p.peer.agent} stale={p.peer.stale} /></>;
  if (f.reason) return <span className={`inline-flex flex-shrink-0 items-center gap-1 ${ink(f)}`}><NeedGlyph card={p.card} size="md" />{f.reason.more > 0 && <span className="typo-label tabular-nums">+{f.reason.more}</span>}</span>;
  if (f.running) return <span className="flex-shrink-0 typo-data tabular-nums ae-tone-text">{f.running.elapsed}</span>;
  return null;
}

function rowClass(base: string, p: LineProps, f: CardFacts): string {
  return `${base} ${toneClass(f.tone)} ${lit(f) ? 'is-lit' : ''} ${f.kind === 'off' ? 'is-off' : ''} ${p.selected ? 'is-selected' : ''}`;
}
/** Working: the edge without the wash, so a busy bay stays calm and needs-you stays loudest. */
const workEdge = (f: CardFacts) => (f.kind === 'working' ? { boxShadow: 'inset 2px 0 0 var(--ae-tone)' } : undefined);

/** V1's tail: the activity as glyph + figure tokens (the reason is already the glyph at the right edge). */
function TailTokens({ f }: { f: CardFacts }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const activity = useActivity(f);
  const L = f.last?.Icon;
  const lead = f.device ? <span className="truncate">{activity.text}</span>
    : f.running ? (f.running.queued > 0 ? <span className="inline-flex flex-shrink-0 items-center gap-1" aria-label={tx(m.caption_queued_many, { count: f.running.queued })}><Hourglass className="h-3 w-3" aria-hidden />{f.running.queued}</span> : null)
      : f.kind === 'off' ? null
        : f.last && L ? <span className="inline-flex flex-shrink-0 items-center gap-1"><L className={`h-3 w-3 ${f.last.ink}`} aria-hidden />{f.last.age}</span>
          : <span className="truncate">{m.board_no_runs}</span>;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden typo-caption tabular-nums text-foreground">
      {lead}
      {f.next && <span className={`inline-flex flex-shrink-0 items-center gap-1 ${lead ? 'ae-sep' : ''}`}><CalendarClock className="h-3 w-3" aria-hidden />{f.next}</span>}
    </span>
  );
}

export function CardTail(p: LineProps) {
  const f = useCardFacts(p);
  return (
    <div data-wp11-card data-kind={f.kind} className={rowClass('ae-line flex min-w-0 items-center gap-2 pl-2 pr-2.5', p, f)} style={{ height: 36, ...workEdge(f) }}>
      <Face p={p} />
      <span className="min-w-0 flex-shrink truncate typo-heading text-foreground">{f.name}</span>
      <TailTokens f={f} />
      <Figure p={p} f={f} />
      {f.kind === 'off' && !p.peer && <PowerOff className="h-3.5 w-3.5 flex-shrink-0 text-foreground" aria-hidden />}
      <Lamp lamp={f.lamp} />
    </div>
  );
}

export function CardGutter(p: LineProps) {
  const f = useCardFacts(p);
  const a = useActivity(f);
  return (
    <div data-wp11-card data-kind={f.kind} className={rowClass('ae-win mx-1.5 mb-[3px] grid min-w-0 items-center gap-x-2 rounded-input pr-2', p, f)} style={{ height: 50, gridTemplateColumns: '18px auto minmax(0,1fr)', ...workEdge(f) }}>
      <span className="flex justify-end"><Lamp lamp={f.lamp} /></span>
      <Face p={p} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate typo-heading text-foreground">{f.name}</span>
          <Figure p={p} f={f} />
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`flex min-w-0 flex-1 items-center gap-1 typo-caption ${a.tone}`}>{a.icon}<span className="truncate">{a.text}</span></span>
          <Next f={f} />
        </span>
      </span>
    </div>
  );
}

const SEG_TONE: Record<string, Tone> = { completed: 'ok', failed: 'err', cancelled: 'off' };

/** The foot: the run against its time cap while it works, else the last six outcomes, oldest first. */
function Foot({ p, f }: { p: LineProps; f: CardFacts }) {
  if (f.running) {
    // Against the persona's own time cap when it has one, else the Board's log age scale.
    const w = (f.running.budget ?? runAgeFraction(p.card.runningSince, Math.floor(p.now / 60_000))) * 100;
    return <span className="ae-bar ae-t-run block" style={{ height: 3 }} aria-hidden><span style={{ width: `${w}%` }} /></span>;
  }
  const six = [...f.recent.slice(0, 6)].reverse();
  if (six.length === 0) return <span className="ae-bar block" style={{ height: 3 }} aria-hidden />;
  return (
    <span className="ae-segs is-thin" style={{ gridTemplateColumns: `repeat(6, minmax(0,1fr))` }} aria-hidden>
      {Array.from({ length: 6 }, (_, i) => {
        const s = six[i - (6 - six.length)];
        return <i key={i} className={s ? `on ${toneClass(SEG_TONE[s] ?? 'off')}` : ''} style={{ height: 3 }} />;
      })}
    </span>
  );
}

export function CardInstrument(p: LineProps) {
  const { t } = useTranslation();
  const f = useCardFacts(p);
  const a = useActivity(f);
  return (
    <div data-wp11-card data-kind={f.kind} className={rowClass('ae-line flex min-w-0 flex-col gap-0.5 px-2.5 pb-1 pt-1', p, f)} style={workEdge(f)}>
      <span className="flex min-w-0 items-center gap-2" style={{ height: 24 }}>
        <Lamp lamp={f.lamp} />
        <Face p={p} size="xs" />
        <span className="min-w-0 flex-1 truncate typo-heading text-foreground">{f.name}</span>
        <Figure p={p} f={f} />
      </span>
      <span className="grid min-w-0 items-center gap-x-3 pl-[18px] typo-caption tabular-nums text-foreground" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
        <span className={`flex min-w-0 items-center gap-1 ${a.tone}`}>{a.icon}<span className="truncate">{a.text}</span></span>
        {/* A peer's snapshot carries no run counts: absent, not 0. */}
        {p.peer ? <span /> : <span className="inline-flex items-center gap-1" aria-label={t.monitor.board_runs_today}><BarChart3 className="h-3 w-3" aria-hidden />{f.runsToday}</span>}
        <span className="inline-flex min-w-[3.25rem] justify-end"><Next f={f} /></span>
      </span>
      <span className="pl-[18px] pt-0.5"><Foot p={p} f={f} /></span>
    </div>
  );
}

export const CARD_VARIANTS = { v1: CardTail, v2: CardGutter, v3: CardInstrument } as const;
export type CardVariant = keyof typeof CARD_VARIANTS;
