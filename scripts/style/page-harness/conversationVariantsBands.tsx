/**
 * WP12 variants: the thread's rows, OUTCOME FIRST.
 *   RunBand     a run (assignment) as an `ae-win` window: eyebrow + lamp, then
 *               what happened (the newest step's output, or what waits on the
 *               operator) as the title, the goal and step count as the caption,
 *               the steps and Pause / Resume folded behind the chevron. A slot
 *               under it carries an inline decision (variant 2).
 *   DelibBand   a deliberation the same way: what the team is leaning to as the
 *               title, the topic, voices, round and spend meter as the caption,
 *               Drive at the right, the turns folded.
 *   TalkLine    a message: persona glyph tile + name for a persona, the
 *               operator's own lines right-aligned in the primary tint.
 *   Proposal    the composer's routed goal waiting on Run it / Drop.
 *   Composer    the composer in the deck's well, its keys printed once.
 */
import type { ReactNode } from 'react';
import { ChevronDown, Pause, Play, Send, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { PersonaStack, usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { useTranslation } from '@/i18n/useTranslation';
import { memberColor } from '@/lib/channel/eventModel';
import { Engraved, Lamp, Segments } from '@/features/fleet/monitor/grid/prototype/entry-e/parts';
import { Keycap } from '@/features/decision-center/deck/parts';
import { COPY, fill, type ThreadRow } from './conversationVariantsData';

type Run = Extract<ThreadRow, { kind: 'run' }>;
type Delib = Extract<ThreadRow, { kind: 'delib' }>;
type Talk = Extract<ThreadRow, { kind: 'talk' }>;
type Proposal = Extract<ThreadRow, { kind: 'proposal' }>;

const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const RUN = {
  done: { win: 'ae-t-ok', lamp: { tone: 'ok', lit: false }, word: COPY.runDone, seg: 'ok' },
  review: { win: 'ae-t-warn is-lit', lamp: { tone: 'warn', lit: true }, word: COPY.runWaiting, seg: 'warn' },
  running: { win: 'ae-t-info is-lit', lamp: { tone: 'info', lit: true }, word: COPY.runRunning, seg: 'info' },
} as const;

function Chevron({ open }: { open: boolean }) {
  return <ChevronDown className={`h-4 w-4 flex-shrink-0 text-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />;
}

function StepList({ run }: { run: Run }) {
  const { t } = useTranslation();
  const index = usePersonaIndex();
  return (
    <div className="space-y-1.5 border-t border-border px-3 py-2">
      {run.steps.map((s, i) => {
        const p = index.get(s.personaId);
        return (
          <div key={s.id} className="grid grid-cols-[1.25rem_1fr_auto] items-baseline gap-x-2">
            <span className="typo-data tabular-nums text-foreground">{i + 1}</span>
            <span className="min-w-0">
              <span className="block typo-body text-foreground">{s.title}</span>
              {s.summary && <span className="block typo-caption">{s.summary}</span>}
            </span>
            <span className="typo-caption" style={{ color: memberColor(p, s.personaId) }}>{p?.name}</span>
          </div>
        );
      })}
      <div className="flex gap-1.5 pt-1">
        <Button variant="ghost" size="xs" icon={<Pause className="h-3 w-3" aria-hidden />}>{t.monitor.conv_pause}</Button>
        <Button variant="ghost" size="xs" icon={<Play className="h-3 w-3" aria-hidden />}>{t.monitor.conv_resume}</Button>
      </div>
    </div>
  );
}

export function RunBand({ run, open = false, children }: { run: Run; open?: boolean; children?: ReactNode }) {
  const { t, tx } = useTranslation();
  const index = usePersonaIndex();
  const meta = RUN[run.state];
  const done = run.steps.filter((s) => s.status === 'done').length;
  return (
    <div className={`ae-win my-2 overflow-hidden rounded-card ${meta.win}`} data-testid="cv-run">
      <Button variant="ghost" size="sm" block className="justify-start! rounded-none px-3! py-2! text-left hover:bg-transparent [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-1">
        <span className="flex w-full items-center gap-2">
          <Lamp lamp={meta.lamp} />
          <Engraved>{meta.word}</Engraved>
          <span className="flex-1" />
          <Segments count={run.steps.length} lit={done} tone={meta.seg} thin className="w-12" />
          <span className="typo-data tabular-nums text-foreground">{tx(t.monitor.conv_steps, { done, total: run.steps.length })}</span>
          <PersonaStack ids={run.steps.map((s) => s.personaId)} index={index} />
          <span className="typo-caption"><RelativeTime timestamp={at(run.minutes)} /></span>
          <Chevron open={open} />
        </span>
        <span className="typo-heading text-foreground [text-wrap:pretty]">{run.outcome}</span>
        <span className="flex items-center gap-1.5 typo-caption"><Wand2 className="h-3.5 w-3.5 text-status-info" aria-hidden />{run.goal}</span>
      </Button>
      {open && <StepList run={run} />}
      {children}
    </div>
  );
}

export function DelibBand({ d, open = false, onDrive, driving = false }: { d: Delib; open?: boolean; onDrive?: () => void; driving?: boolean }) {
  const { t } = useTranslation();
  const index = usePersonaIndex();
  const share = Math.min(1, d.spent / d.budget);
  return (
    <div className="ae-win ae-t-agent is-lit my-2 overflow-hidden rounded-card" data-testid="cv-delib">
      <div className="flex items-start gap-2 px-3 py-2">
        <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start! px-0! py-0! text-left hover:bg-transparent [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-1">
          <span className="flex w-full items-center gap-2">
            <Lamp lamp={{ tone: 'run', lit: true }} />
            <Engraved>{COPY.deliberation} · {COPY.converging} · {fill(COPY.roundOf, { round: d.round })}</Engraved>
            <span className="flex-1" />
            <span className="ae-bar ae-t-agent w-16 flex-shrink-0" aria-hidden><i style={{ width: `${share * 100}%` }} /></span>
            <span className="typo-data tabular-nums text-foreground">$<Numeric value={d.spent} precision={2} /> / <Numeric value={d.budget} precision={2} /></span>
            <PersonaStack ids={d.voices} index={index} />
            <span className="typo-caption"><RelativeTime timestamp={at(d.minutes)} /></span>
          </span>
          <span className="typo-heading text-foreground"><span className="typo-label text-role-agent">{COPY.leaning}: </span>{d.leaning}</span>
          <span className="typo-caption">{d.topic} · {fill(COPY.turns, { count: d.turns.length })}</span>
        </Button>
        <Button variant="accent" tone="agent" size="xs" onClick={onDrive} aria-pressed={driving} className="flex-shrink-0">{t.monitor.conv_drive}</Button>
        <Chevron open={open} />
      </div>
      {open && (
        <div className="space-y-1.5 border-t border-border px-3 py-2">
          {d.turns.map((turn, i) => {
            const p = index.get(turn.personaId);
            return (
              <p key={i} className="typo-body text-foreground">
                <span className="typo-caption" style={{ color: memberColor(p, turn.personaId) }}>{p?.name} </span>{turn.body}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TalkLine({ row, compact = false }: { row: Talk; compact?: boolean }) {
  const p = usePersonaIndex().get(row.personaId ?? '');
  if (row.who === 'operator') {
    return (
      <div className="flex justify-end py-1">
        <div className="max-w-[72%] rounded-card border border-primary/20 bg-primary/12 px-3 py-2">
          <MarkdownRenderer content={row.body} className="typo-body text-foreground [&_p]:mb-0" />
        </div>
      </div>
    );
  }
  const name = row.who === 'athena' ? 'Athena' : p?.name ?? '';
  return (
    <div className="flex items-start gap-2.5 py-1">
      {row.who === 'athena' ? (
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-card border border-role-agent/30 bg-role-agent/10"><Sparkles className="h-3.5 w-3.5 text-role-agent" aria-hidden /></span>
      ) : p ? <PersonaIcon icon={p.icon} color={p.color} display="framed" frameSize="md" /> : null}
      <div className={`min-w-0 ${compact ? 'flex-1' : 'max-w-[78%]'} rounded-card border border-border bg-secondary/30 px-3 py-2`}>
        <span className="mb-0.5 flex items-center gap-2">
          <span className="typo-heading" style={{ color: row.who === 'athena' ? undefined : memberColor(p, row.personaId ?? '') }}>{name}</span>
          <span className="typo-caption"><RelativeTime timestamp={at(row.minutes)} /></span>
        </span>
        <MarkdownRenderer content={row.body} className="typo-body text-foreground [&_p]:mb-0" />
      </div>
    </div>
  );
}

export function ProposalBand({ row }: { row: Proposal }) {
  const { t } = useTranslation();
  const index = usePersonaIndex();
  return (
    <div className="ae-win ae-t-info is-lit my-2 overflow-hidden rounded-card px-3 py-2">
      <span className="flex items-center gap-2">
        <Lamp lamp={{ tone: 'info', lit: true }} />
        <Engraved>{COPY.proposal}</Engraved>
      </span>
      <span className="mt-1 block typo-heading text-foreground">{row.goal}</span>
      <div className="mt-1.5 space-y-1">
        {row.steps.map((s, i) => {
          const p = s.personaId ? index.get(s.personaId) : undefined;
          return (
            <div key={i} className="grid grid-cols-[1.25rem_1fr_auto] gap-x-2">
              <span className="typo-data tabular-nums text-foreground">{i + 1}</span>
              <span className="typo-body text-foreground">{s.title}</span>
              <span className="typo-caption" style={{ color: memberColor(p, s.personaId ?? '') }}>{p?.name ?? t.monitor.conv_unrouted}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5">
        <Button variant="accent" tone="success" size="xs">{t.monitor.conv_proposal_run}</Button>
        <Button variant="ghost" size="xs">{t.monitor.conv_proposal_drop}</Button>
      </div>
    </div>
  );
}

export function DayRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="h-px flex-1 bg-border" />
      <Engraved>{label}</Engraved>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** The composer in the deck's well; Enter sends (or routes, when it reads like work). */
export function Composer({ team }: { team: string }) {
  const { t } = useTranslation();
  return (
    <div className="au-scope flex-shrink-0 border-t border-border px-3 py-2">
      <div className="au-well flex items-end gap-2 rounded-input px-3 py-1.5">
        <textarea rows={1} placeholder={fill(COPY.composer, { team })} aria-label={t.monitor.conv_title} className="min-w-0 flex-1 resize-none bg-transparent py-1.5 typo-body text-foreground placeholder:text-foreground/50 focus:outline-none" />
        <Button variant="ghost" size="sm" icon={<Send className="h-4 w-4" aria-hidden />} className="au-lift flex-shrink-0 text-status-success [&>span:last-child]:inline-flex [&>span:last-child]:items-center [&>span:last-child]:gap-1.5">
          {t.monitor.conv_composer_send} <Keycap>↵</Keycap>
        </Button>
      </div>
    </div>
  );
}
