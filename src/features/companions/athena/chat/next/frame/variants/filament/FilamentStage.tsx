/**
 * Filament · the combined queue surface (contest B/1's `.q-spread`): one
 * panel with a side rail (the waiting queue + every project's processes,
 * `.qlist` / `.proj` / `.wire` / `.pdot`) and a main stage holding the real
 * Oracle content (`../c/bodies/CardBody.tsx` — same verbs, same models as
 * Halo · Spread). No ring, no filigree, no dealt deck: a lit rail instead of
 * a card border, a side list instead of a binder of tiles.
 *
 * `VariantFrame` mounts this in the centre column's middle cell exactly like
 * `SpreadStage`; it does not (yet) also draw `useProcessColumns` data in the
 * right-edge slim line (`FilamentPanel.tsx`) — the contest drew the queue's
 * sidebar and its slim ambient line as one segment, production's slot
 * contract keeps them in two mount points. Known gap, not a redesign.
 *
 * TODO(prototype, 2026-10-03): first in-app port of the contest winner.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useAthenaStore } from '../../../../../athenaStore';
import { ATHENA_COLUMN, type ProcessMark, type ProjectColumn } from '../../../useProcessColumns';
import { KIND_VAR } from '../../../tones';
import type { WorkItem } from '../../../useWorkforce';
import type { DecisionStageProps } from '../../slots';
import { useProcessColumns } from '../../../useProcessColumns';
import { useWorkforce } from '../../../useWorkforce';
import { NEXT_COPY as NC } from '../../../nextCopy';
import { FilamentOracle } from './FilamentOracle';
import { FILAMENT_COPY as F } from './copy';
import './filament.css';

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/**
 * The queue by SOURCE, not by title. A work item's `title` is its whole
 * prompt — it never fit this rail and truncating it told the operator
 * nothing. What they actually need here is "who is waiting, and how many",
 * and the item itself is read in the main stage.
 */
function SourceList({ items, activeId, onPick }: { items: WorkItem[]; activeId: string | null; onPick: (id: string) => void }) {
  const groups = useMemo(() => {
    const by = new Map<string, WorkItem[]>();
    for (const it of items) {
      const key = it.project ?? F.athenaOwn;
      const list = by.get(key);
      if (list) list.push(it);
      else by.set(key, [it]);
    }
    return [...by.entries()];
  }, [items]);

  if (!groups.length) return <p className="typo-caption qs-none">{F.nothingWaiting}</p>;
  return (
    <ol className="qlist">
      {groups.map(([source, list]) => {
        const holdsActive = list.some((i) => i.id === activeId);
        const c = KIND_VAR[list[0]!.kind];
        return (
          <li key={source}>
            <button
              type="button"
              className="qitem"
              aria-current={holdsActive}
              style={{ ['--c' as string]: c }}
              onClick={() => onPick((list.find((i) => i.id === activeId) ?? list[0]!).id)}
            >
              <span className="bead" style={{ ['--c' as string]: c }} aria-hidden />
              <span className="typo-title text-foreground qs-source">{source}</span>
              <span className="typo-data qs-count">{list.length}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ProjWire({ p }: { p: ProcessMark }) {
  return (
    <button
      type="button"
      className={`pdot${p.urgent ? ' urgent' : ''}${p.state === 'running' ? ' run' : ''}`}
      style={{ ['--c' as string]: p.urgent ? 'var(--status-warning)' : 'var(--primary)' }}
      onClick={p.open}
      aria-label={`${p.label}, ${p.state}`}
    >
      <span />
    </button>
  );
}

/**
 * Running work, abstracted: one line per project — its monogram, a strip of
 * state dots, a count. The name is a tooltip, not a column; the per-process
 * labels live where they are actionable (their own surfaces), which is what
 * makes this fit a 260px rail instead of spilling out of it.
 */
function ProjectStrip({ columns }: { columns: ProjectColumn[] }) {
  const rows = columns.filter((c) => c.processes.length);
  if (!rows.length) return <p className="typo-caption qs-none">{F.nothingRunning}</p>;
  return (
    <div className="projstrip">
      {rows.map((c) => {
        const shown = c.processes.slice(0, 8);
        const over = c.processes.length - shown.length;
        return (
          <Tooltip key={c.key} placement="right" content={c.label}>
            <div className="projrow" style={{ ['--h' as string]: c.key === ATHENA_COLUMN ? 'var(--primary)' : 'var(--role-external)' }}>
              {/* A monogram alone is not identity — six projects here start
                  with the same letter. Short name, truncated, does the job in
                  the same width. */}
              <span className="typo-label projname">{c.key === ATHENA_COLUMN ? F.athenaOwn : c.label}</span>
              <span className="wire" role="group" aria-label={c.label}>
                {shown.map((p) => (
                  <ProjWire key={p.id} p={p} />
                ))}
                {over > 0 && <span className="typo-caption over">+{over}</span>}
              </span>
              <span className="typo-data cnt">{c.processes.length}</span>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function FilamentStage(props: DecisionStageProps) {
  // AnimatePresence lives here, not inside `Stage`, so the panel can play its
  // exit wipe after `open` goes false instead of vanishing on unmount.
  return <AnimatePresence>{props.open && <Stage {...props} />}</AnimatePresence>;
}

function Stage({ items, focusId, onFocus, onClose, onSend }: DecisionStageProps) {
  const { shouldAnimate } = useMotion();
  const workforce = useWorkforce();
  const columns = useProcessColumns(workforce, NC.athena);
  const [aside, setAside] = useState<ReadonlySet<string>>(() => new Set());
  const live = useMemo(() => items.filter((i) => !aside.has(i.id)), [items, aside]);
  const [activeId, setActiveId] = useState<string | null>(focusId ?? live[0]?.id ?? null);
  const active = live.find((i) => i.id === activeId) ?? null;
  const streaming = useAthenaStore((s) => s.streaming);

  const stateRef = useRef({ live, activeId });
  stateRef.current = { live, activeId };

  useEffect(() => {
    if (activeId && live.some((i) => i.id === activeId)) return;
    const next = live[0] ?? null;
    setActiveId(next ? next.id : null);
  }, [live, activeId]);

  const pick = useCallback(
    (id: string) => {
      setActiveId(id);
      onFocus(id);
    },
    [onFocus],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      const { live: l, activeId: cur } = stateRef.current;
      if (l.length < 2) return;
      const at = Math.max(0, l.findIndex((i) => i.id === cur));
      pick(l[(at + dir + l.length) % l.length]!.id);
    },
    [pick],
  );

  useAppKeyboard(
    (e) => {
      const el = document.activeElement;
      if (e.altKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        onClose();
        return true;
      }
      if (e.key === 'Escape') {
        if (el && isTyping(el) && (el as HTMLInputElement).value) return false;
        e.preventDefault();
        onClose();
        return true;
      }
      if (isTyping(el) || e.altKey || e.ctrlKey || e.metaKey) return false;
      if (e.key === ' ') {
        if (!stateRef.current.activeId) return false;
        e.preventDefault();
        setAside((s) => (stateRef.current.activeId ? new Set(s).add(stateRef.current.activeId) : s));
        return true;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (stateRef.current.live.length < 2) return false;
        e.preventDefault();
        step(e.key === 'ArrowRight' ? 1 : -1);
        return true;
      }
      return false;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 1 },
  );

  const runningTotal = columns.flatMap((c) => c.processes).filter((p) => p.state === 'running').length;
  const color = active ? KIND_VAR[active.kind] : 'var(--primary)';

  return (
    <motion.div
      className="filament-frame absolute inset-0 z-20 flex items-center justify-end"
      style={{ background: 'color-mix(in srgb, var(--background) 55%, transparent)', backdropFilter: 'blur(4px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: shouldAnimate ? 0.22 : 0 }}
    >
      {/* The mock unrolls the panel out of the line it was drawn on; same
          gesture here, as a clip-path wipe from the right edge inward. */}
      <motion.div
        className="spread q-spread"
        role="region"
        aria-label={F.label}
        initial={shouldAnimate ? { clipPath: 'inset(0 0 0 100% round 16px)' } : { opacity: 0 }}
        animate={shouldAnimate ? { clipPath: 'inset(0 0 0 0% round 16px)' } : { opacity: 1 }}
        exit={shouldAnimate ? { clipPath: 'inset(0 0 0 100% round 16px)' } : { opacity: 0 }}
        transition={{ duration: shouldAnimate ? 0.42 : 0, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <span className="lit-edge" aria-hidden />
        <header className="qs-head">
          <nav className="crumbs typo-caption" aria-label="Where you are">
            <span className="here">{F.label}</span>
          </nav>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn typo-label" onClick={onClose}>
            Fold <span className="kbd typo-caption">Esc</span>
          </button>
        </header>
        <div className="qs-body">
          <aside className="qs-side" aria-label="Queue and projects">
            <div>
              <p className="side-h">
                <span className="typo-eyebrow">Waiting on you</span>
                <span className="typo-caption">
                  <span className="kbd typo-caption">←</span> <span className="kbd typo-caption">→</span>
                </span>
              </p>
              <SourceList items={live} activeId={active?.id ?? null} onPick={pick} />
            </div>
            <div>
              <p className="side-h">
                <span className="typo-eyebrow">Running</span>
                <span className="typo-caption">{F.running(runningTotal)}</span>
              </p>
              <ProjectStrip columns={columns} />
            </div>
          </aside>
          <div className="qs-main" style={{ ['--c' as string]: color }}>
            <span className="lit-rail" aria-hidden />
            {active ? (
              <FilamentOracle item={active} color={color} waiting={Math.max(0, live.length - 1)} onSend={onSend} />
            ) : (
              <div className="empty-q">
                <div>
                  <p className="typo-hero" style={{ color: 'var(--status-success)' }}>
                    {F.emptyTitle}
                  </p>
                  <p className="typo-body-lg">{F.emptySub}</p>
                </div>
              </div>
            )}
          </div>
        </div>
        <footer className="qs-foot typo-caption">
          <span><span className="kbd typo-caption">1–9</span> choose</span>
          <span><span className="kbd typo-caption">↑</span><span className="kbd typo-caption">↓</span> move</span>
          <span><span className="kbd typo-caption">0</span> ask Athena</span>
          <span><span className="kbd typo-caption">Enter</span> confirm her pick</span>
          <span><span className="kbd typo-caption">Space</span> set aside</span>
          <span><span className="kbd typo-caption">←</span><span className="kbd typo-caption">→</span> walk the queue</span>
        </footer>
      </motion.div>
      {streaming && <span className="sr-only">Working</span>}
    </motion.div>
  );
}
