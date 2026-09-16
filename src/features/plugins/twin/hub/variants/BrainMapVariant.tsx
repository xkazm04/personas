/**
 * Variant "map" — the twin's memory as a PIPELINE you can read in one glance,
 * then act inside.
 *
 * Five stages carry what the brain does with what it hears: captured → pending
 * → approved → distilled facts → wiki. Each node states its count ONCE and is
 * sized and filled as its share of the busiest stage, because five identical
 * boxes would have been a diagram rather than a reading. The channel between
 * two stages is filled to the fraction that survived the step, so attrition is
 * geometry and no sentence has to restate it.
 *
 * Reflections hang off the side as their own cluster: the brain PRODUCES them,
 * it does not carry them through. The reply lane sits beside them as the
 * outbound end — clicking it opens the real draft → review → log loop.
 *
 * Clicking any stage reveals its rows in place with the same inline react
 * affordances every other variant offers, so the map is usable rather than
 * decorative. Motion happens on mount and on interaction only — nothing loops —
 * and `useReducedMotion` degrades the whole thing to the static layout.
 */

import { useMemo, useState } from 'react';
import { BookHeart, Check, Library, Radio, ScrollText, Send, Wand2 } from 'lucide-react';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import { HubEntryRow } from '../HubEntryRow';
import { ReplyLane } from '../ReplyLane';
import { MapConnector, MapStageNode, type MapStage, type MapStageRole } from './MapStageNode';
import type { HubEntry, HubVariantProps } from '../hubContract';

/** Rows one opened stage reveals. Beyond this the map stops being a glance. */
const STAGE_ROW_CAP = 40;

type StageId = 'captured' | 'pending' | 'approved' | 'facts' | 'wiki' | 'reflections' | 'reply';

/** Stage → semantic role. Each stage owns its own set so the fill can be a
 *  stronger wash than the node's background without composing opacities. */
const ROLE: Record<StageId, MapStageRole> = {
  captured: { text: 'text-status-info', bg: 'bg-status-info/8', border: 'border-status-info/30', fill: 'bg-status-info/25' },
  pending: { text: 'text-status-pending', bg: 'bg-status-pending/8', border: 'border-status-pending/30', fill: 'bg-status-pending/25' },
  approved: { text: 'text-status-success', bg: 'bg-status-success/8', border: 'border-status-success/30', fill: 'bg-status-success/25' },
  facts: { text: 'text-primary', bg: 'bg-primary/8', border: 'border-primary/30', fill: 'bg-primary/25' },
  wiki: { text: 'text-status-warning', bg: 'bg-status-warning/8', border: 'border-status-warning/30', fill: 'bg-status-warning/25' },
  reflections: { text: 'text-status-neutral', bg: 'bg-status-neutral/8', border: 'border-status-neutral/30', fill: 'bg-status-neutral/25' },
  reply: { text: 'text-status-success', bg: 'bg-status-success/8', border: 'border-status-success/30', fill: 'bg-status-success/25' },
};

export default function BrainMapVariant({ feed }: HubVariantProps) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.twin.hub;
  const reduced = useReducedMotion();
  const [open, setOpen] = useState<StageId | null>(null);
  const enter = useRevealTracker(open ?? 'closed');

  const { entries, counts } = feed;
  const wikiFiles = feed.sources.wikiFiles ?? 0;

  const { pipeline, aside } = useMemo(() => {
    const of = (fn: (e: HubEntry) => boolean) => entries.filter(fn);
    const stage = (
      id: StageId, Icon: MapStage['Icon'], count: number, entries: MapStage['entries'],
    ): MapStage<StageId> => ({ id, Icon, role: ROLE[id], count, entries });
    const captured = of((e) => e.kind !== 'fact' && e.kind !== 'reflection');
    return {
      pipeline: [
        stage('captured', Radio, captured.length, captured),
        stage('pending', Wand2, counts.pending, of((e) => e.status === 'pending')),
        stage('approved', Check, counts.approved, of((e) => e.status === 'approved')),
        stage('facts', Library, counts.facts, of((e) => e.kind === 'fact')),
        // The wiki is compiled FROM the facts; what it hands back to the brain
        // is its audit reports, so those are the rows this stage reveals.
        stage('wiki', ScrollText, wikiFiles, of((e) => e.kind === 'audit')),
      ],
      aside: [
        stage('reflections', BookHeart, counts.reflections, of((e) => e.kind === 'reflection')),
        stage('reply', Send, counts.messages, []),
      ],
    };
  }, [entries, counts, wikiFiles]);

  const peak = Math.max(1, ...pipeline.map((s) => s.count), ...aside.map((s) => s.count));
  const active = [...pipeline, ...aside].find((s) => s.id === open) ?? null;
  const rows = active ? active.entries.slice(0, STAGE_ROW_CAP) : [];
  const toggle = (id: StageId) => setOpen((cur) => (cur === id ? null : id));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 xl:px-8 py-4 space-y-4">
      {/* ── The pipeline, plus the cluster that hangs off it ───────── */}
      <div className="flex flex-col xl:flex-row xl:items-center gap-4">
        <div className="flex-1 min-w-0 overflow-x-auto">
          <div className="flex items-start gap-1 min-w-max pr-2">
            {pipeline.map((s, i) => (
              <div key={s.id} className="flex items-start gap-1">
                <MapStageNode
                  stage={s} label={t.map.stages[s.id]} peak={peak} index={i}
                  open={open === s.id} reduced={reduced} onToggle={() => toggle(s.id)}
                />
                {i < pipeline.length - 1 && (
                  <MapConnector
                    ratio={pipeline[i + 1]!.count / Math.max(1, s.count)}
                    label={tx(t.map.throughput, {
                      percent: Math.round(Math.min(1, pipeline[i + 1]!.count / Math.max(1, s.count)) * 100),
                      from: t.map.stages[s.id],
                      to: t.map.stages[pipeline[i + 1]!.id],
                    })}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <aside className="flex items-start gap-3 xl:border-l xl:pl-4 border-border">
          <span className="typo-label text-foreground self-center max-w-[6rem]">{t.map.asideLabel}</span>
          {aside.map((s, i) => (
            <MapStageNode
              key={s.id} stage={s} label={t.map.stages[s.id]} peak={peak} index={pipeline.length + i}
              open={open === s.id} reduced={reduced} onToggle={() => toggle(s.id)}
            />
          ))}
        </aside>
      </div>

      {/* ── The opened stage, in place ─────────────────────────────── */}
      <Collapse open={active !== null} unmountWhenClosed>
        <div className="rounded-card border border-border bg-card/20 p-3 space-y-2">
          <p className="typo-label text-foreground">
            {active ? tx(t.map.openHeading, { stage: t.map.stages[active.id], count: active.count }) : ''}
          </p>
          {active?.id === 'reply' ? (
            <ReplyLane />
          ) : feed.loading && rows.length === 0 ? (
            <MapGhost />
          ) : rows.length === 0 ? (
            <p className="typo-caption text-foreground">{t.map.emptyStage}</p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {rows.map((entry, i) => (
                  <HubEntryRow key={entry.id} entry={entry} feed={feed} order={i} enter={enter} />
                ))}
              </ul>
              {active && active.entries.length > rows.length && (
                <p className="typo-caption text-foreground tabular-nums">
                  {tx(t.map.capped, { shown: rows.length, total: active.entries.length })}
                </p>
              )}
            </>
          )}
        </div>
      </Collapse>
    </div>
  );
}

/** Calm, geometry-matched ghost under the permanent map — never a spinner. */
function MapGhost() {
  return (
    <ul className="space-y-1.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-start gap-2 rounded-card border border-border bg-card/40 px-3 py-2 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}>
          <span className="w-5 h-5 rounded-full bg-primary/[0.06] flex-shrink-0" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-1/3 rounded bg-primary/[0.06]" />
            <span className="block h-3 w-3/4 rounded bg-primary/[0.06]" />
          </span>
        </li>
      ))}
    </ul>
  );
}
