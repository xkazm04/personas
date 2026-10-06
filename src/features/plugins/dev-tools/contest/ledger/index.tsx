// Season Ledger: the Contest page as three real surfaces joined by a camera.
//
//   LEDGER   every contest, one line (Level 1)
//   CONTEST  seats as dials, the chain, the decision and the sorting bench (Level 2)
//   VARIANT  the live page with its pins, the trays and the notes (Level 3)
//
// Enter pushes the camera into the row or card you chose; Esc pulls it back
// out onto where you were. The drawers (New contest, Standings) open over the
// level you are on. Won /contest `contest-arena-restyle` (A/3) on 2026-09-25 and
// replaced the Arena. Takes no props: it reads the contest hooks and
// `contest/focus.ts` (a "ready for review" notice focuses a contest from outside).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layers, List, ListOrdered, Lock, MapPin, Plus, Search, Film, Trophy } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useElementSize } from '@/hooks/utility/interaction/useElementSize';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { ReadinessStrip } from '../components/ReadinessStrip';
import { focusContest, useContestFocus } from '../focus';
import { useContest, useContests } from '../hooks/useContests';
import { useReviewDraft } from '../hooks/useReviewDraft';
import { recordedBucket, stepKey } from '../model/contestModel';
import { phaseLabel } from '../model/labels';
import type { DesignWidth } from '../model/pinMath';
import { setBucket } from '../model/reviewModel';
import { seatLabel } from '../model/seatCatalog';
import { ContestLevel, isEditable, lockText } from './ContestLevel';
import { keyOf, ledgerCounts, ledgerGroups, ledgerOrder, shortTitle, type LedgerFilter } from './ledgerModel';
import { useLedgerWindow } from './useLedgerWindow';
import { LedgerLevel } from './LedgerLevel';
import { formatDay, Kbd, prefersReducedMotion, Rich, useNow } from './parts';
import { SetupDrawer } from './SetupDrawer';
import { StandingsDrawer } from './StandingsDrawer';
import { VariantLevel } from './VariantLevel';

import './ledger.css';

type Level = 1 | 2 | 3;
type Drawer = 'setup' | 'standings' | null;

const KEY_BUCKET: Record<string, ContestReviewBucket> = { '1': 'winner', '2': 'shortlist', '3': 'impractical', '4': 'failure' };
/** Where the page switches to its wide layout (a 1920 window gives 1592). */
const WIDE_AT = 1500;
const EASE = 'cubic-bezier(.2,.75,.25,1)';

interface Camera {
  from: Level;
  to: Level;
  /** Where the push starts, relative to the stage (captured before the switch). */
  rect: { x: number; y: number; w: number; h: number } | null;
}

export default function LedgerShell() {
  const { t, tx, language } = useTranslation();
  const s = t.plugins.contest;
  const L = s.ledger;
  const list = useContests();
  const contests = list.contests;
  const activeProjectId = useSystemStore((st) => st.activeProjectId);

  const [level, setLevel] = useState<Level>(1);
  const [key, setKey] = useState<string | null>(null);
  const [vkey, setVkey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilter | null>(null);
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [width, setWidth] = useState<DesignWidth>(1280);
  const [pinMode, setPinMode] = useState(false);
  const [leaving, setLeaving] = useState<Level | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const levelRefs = { 1: useRef<HTMLElement>(null), 2: useRef<HTMLElement>(null), 3: useRef<HTMLElement>(null) } as const;
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const searchRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const camera = useRef<Camera | null>(null);

  const rootSize = useElementSize(rootRef);
  const wide = rootSize.width >= WIDE_AT;

  const summary = useMemo(() => (key ? contests.find((c) => keyOf(c) === key) ?? null : null), [contests, key]);
  const [projectId, contestId] = key ? (key.split('/', 2) as [string, string]) : [null, null];
  const { detail, error: detailError } = useContest(level >= 2 ? projectId : null, level >= 2 ? contestId : null);
  const draft = useReviewDraft(level >= 2 ? detail : null);
  const anyRunning = contests.some((c) => c.ledger.seats.some((x) => x.state === 'running'));
  const nowMs = useNow(anyRunning);

  const searchText = useCallback(
    (c: ContestSummary) => [c.title, c.projectName, phaseLabel(s, c.phase), ...c.seatSpecs.map((x) => { const l = seatLabel(x); return `${l.model} ${l.effort ?? ''}`; })].join(' '),
    [s],
  );
  const groups = useMemo(() => ledgerGroups(contests, filter, query, searchText), [contests, filter, query, searchText]);
  // Keyboard walks the WHOLE filtered set, not the window: ↑/↓ past the last
  // rendered row opens the next page rather than stopping at it.
  const order = useMemo(() => ledgerOrder(groups), [groups]);
  const revealKey = `${filter ?? ''}|${query.trim()}`;
  const ledgerWindow = useLedgerWindow(groups, revealKey);
  const enter = useRevealTracker(revealKey, 'contest-ledger');

  // ── The camera ──────────────────────────────────────────────
  const rectIn = (el: HTMLElement | null) => {
    const stage = stageRef.current;
    if (!el || !stage) return null;
    const r = el.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    return { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height };
  };
  const go = useCallback((to: Level, from: HTMLElement | null) => {
    setLevel((cur) => {
      if (cur === to) return cur;
      camera.current = { from: cur, to, rect: to > cur ? rectIn(from) : null };
      setLeaving(cur);
      return to;
    });
  }, []);

  useLayoutEffect(() => {
    const cam = camera.current;
    if (!cam) return;
    camera.current = null;
    const stage = stageRef.current;
    const incoming = levelRefs[cam.to].current;
    const outgoing = levelRefs[cam.from].current;
    if (!stage || !incoming || !outgoing || prefersReducedMotion() || !incoming.animate) {
      setLeaving(null);
      return;
    }
    const sw = stage.clientWidth || 1;
    const sh = stage.clientHeight || 1;
    if (cam.to > cam.from) {
      if (cam.rect) {
        const from = `translate(${cam.rect.x}px, ${cam.rect.y}px) scale(${cam.rect.w / sw}, ${cam.rect.h / sh})`;
        incoming.animate([{ transform: from, opacity: 0.2, borderRadius: '10px' }, { transform: 'none', opacity: 1, borderRadius: '0px' }], { duration: 300, easing: EASE });
      }
      const fade = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
      fade.onfinish = () => {
        fade.cancel();
        setLeaving(null);
      };
      return;
    }
    // Pulling back out: the outgoing level shrinks onto the row or card it came from.
    const target = cam.to === 1 && key ? rowRefs.current.get(key) : cam.to === 2 && vkey ? cardRefs.current.get(vkey) : null;
    target?.scrollIntoView?.({ block: 'nearest' });
    const r = rectIn(target ?? null);
    incoming.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    const to = r ? `translate(${r.x}px, ${r.y}px) scale(${r.w / sw}, ${r.h / sh})` : 'scale(0.96)';
    const shrink = outgoing.animate([{ transform: 'none', opacity: 1 }, { transform: to, opacity: 0 }], { duration: 260, easing: EASE, fill: 'forwards' });
    shrink.onfinish = () => {
      shrink.cancel();
      setLeaving(null);
    };
    target?.animate?.(
      [{ boxShadow: 'inset 0 0 0 1px var(--primary), 0 0 0 4px color-mix(in srgb, var(--primary) 25%, transparent)' }, { boxShadow: 'inset 0 0 0 1px transparent' }],
      { duration: 900, easing: 'ease-out' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  // ── Navigation ──────────────────────────────────────────────
  const openContest = useCallback(
    (k: string, from: HTMLElement | null) => {
      setKey(k);
      setFocusKey(k);
      setVkey(null);
      setCard(null);
      setPinMode(false);
      go(2, from);
    },
    [go],
  );
  const openVariant = useCallback(
    (v: string | null, from: HTMLElement | null) => {
      const variants = detail?.variants ?? [];
      if (!variants.length) return;
      const pick = v && variants.some((x) => x.key === v) ? v : variants[0]!.key;
      setVkey(pick);
      setCard(pick);
      setPinMode(false);
      go(3, from ?? cardRefs.current.get(pick) ?? null);
    },
    [detail, go],
  );
  const backToLedger = useCallback(() => {
    setPinMode(false);
    go(1, null);
  }, [go]);
  const backToContest = useCallback(() => {
    setPinMode(false);
    go(2, null);
  }, [go]);

  // A contest focused from outside (a notice, the Monitor, a refine) opens its level.
  const focused = useContestFocus((st) => st.focused);
  const focusSeq = useContestFocus((st) => st.focusSeq);
  const handledSeq = useRef(0);
  useEffect(() => {
    if (!focused || focusSeq === handledSeq.current) return;
    const k = `${focused.projectId}/${focused.contestId}`;
    if (!contests.some((c) => keyOf(c) === k)) return; // wait for the list
    handledSeq.current = focusSeq;
    setDrawer(null);
    openContest(k, rowRefs.current.get(k) ?? null);
  }, [focused, focusSeq, contests, openContest]);

  // The bench's focused card: the first unsorted, else the first variant.
  useEffect(() => {
    if (level !== 2 || !detail || card) return;
    const first = detail.variants.find((v) => !recordedBucket(draft.review, detail.summary, v.key)) ?? detail.variants[0];
    if (first) setCard(first.key);
  }, [level, detail, draft.review, card]);

  const sort = useCallback(
    (v: string, bucket: ContestReviewBucket | null) => {
      if (!summary) return;
      if (!isEditable(summary)) {
        useToastStore.getState().addToast(lockText(L, s, summary, tx) ?? L.sorting_closed, 'warning');
        return;
      }
      draft.apply((r) => setBucket(r, v, bucket));
    },
    [summary, draft, L, s, tx],
  );

  // ── Keyboard: route-level decision surface (priority 10, the app registry) ──
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (drawer) return; // the drawer's own dialog owns the keys
    const target = e.target as HTMLElement | null;
    // A dialog above the page (a confirm, an app overlay) owns the keys.
    if (target?.closest?.('[role="dialog"],[role="alertdialog"]') || document.querySelector('[aria-modal="true"]')) return;
    if (!rootRef.current?.isConnected) return;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        target!.blur();
      }
      return;
    }
    const k = e.key;
    if (level === 1) {
      const i = focusKey ? order.indexOf(focusKey) : -1;
      const move = (to: string | undefined) => {
        if (!to) return;
        setFocusKey(to);
        ledgerWindow.revealThrough(order.indexOf(to));
        rowRefs.current.get(to)?.scrollIntoView?.({ block: 'nearest' });
      };
      if (k === 'ArrowDown' || k === 'j' || k === 'J') {
        e.preventDefault();
        move(order[Math.min(order.length - 1, i + 1)] ?? order[0]);
      } else if (k === 'ArrowUp' || k === 'k' || k === 'K') {
        e.preventDefault();
        move(order[Math.max(0, i - 1)] ?? order[0]);
      } else if (k === 'Enter' && focusKey) {
        e.preventDefault();
        openContest(focusKey, rowRefs.current.get(focusKey) ?? null);
      } else if (k === 'Escape' && (filter || query)) {
        e.preventDefault();
        setFilter(null);
        setQuery('');
      } else if (k === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (k === 'n' || k === 'N') {
        e.preventDefault();
        setDrawer('setup');
      } else if (k === 's' || k === 'S') {
        e.preventDefault();
        setDrawer('standings');
      }
      return;
    }
    if (level === 2) {
      const dirs: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      if (dirs[k]) {
        e.preventDefault();
        moveCard(dirs[k]!);
      } else if (KEY_BUCKET[k] && card) {
        e.preventDefault();
        const cur = recordedBucket(draft.review, summary, card);
        sort(card, cur === KEY_BUCKET[k] ? null : KEY_BUCKET[k]!);
      } else if (k === '0' && card) {
        e.preventDefault();
        sort(card, null);
      } else if (k === 'Enter') {
        e.preventDefault();
        openVariant(card, null);
      } else if (k === 'Escape') {
        e.preventDefault();
        backToLedger();
      } else if (k === 'n' || k === 'N') {
        e.preventDefault();
        setDrawer('setup');
      } else if (k === 's' || k === 'S') {
        e.preventDefault();
        setDrawer('standings');
      } else if (k === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      return;
    }
    if (level === 3 && vkey) {
      const keys = (detail?.variants ?? []).map((v) => v.key);
      if (k === 'ArrowLeft' || k === 'j' || k === 'J') {
        e.preventDefault();
        const next = stepKey(keys, vkey, -1);
        if (next) setVkey(next);
      } else if (k === 'ArrowRight' || k === 'k' || k === 'K') {
        e.preventDefault();
        const next = stepKey(keys, vkey, 1);
        if (next) setVkey(next);
      } else if (KEY_BUCKET[k]) {
        e.preventDefault();
        const cur = recordedBucket(draft.review, summary, vkey);
        sort(vkey, cur === KEY_BUCKET[k] ? null : KEY_BUCKET[k]!);
      } else if (k === '0') {
        e.preventDefault();
        sort(vkey, null);
      } else if (k === 'p' || k === 'P') {
        e.preventDefault();
        if (summary && isEditable(summary)) setPinMode((on) => !on);
      } else if (k === 'n' || k === 'N') {
        e.preventDefault();
        const el = noteRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      } else if (k === 'w' || k === 'W') {
        e.preventDefault();
        setWidth((w) => (w === 1280 ? 1920 : 1280));
      } else if (k === 'Escape') {
        e.preventDefault();
        if (pinMode) setPinMode(false);
        else backToContest();
      }
    }
  };
  const moveCard = (dir: 'left' | 'right' | 'up' | 'down') => {
    const cards = [...cardRefs.current.entries()];
    if (!cards.length) return;
    const cur = cards.find(([k]) => k === card);
    if (!cur) {
      setCard(cards[0]![0]);
      return;
    }
    const a = cur[1].getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: string | null = null;
    let bestD = Infinity;
    for (const [k, el] of cards) {
      if (k === card) continue;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax;
      const dy = b.top + b.height / 2 - ay;
      let ok = false;
      let dist = 0;
      if (dir === 'left') [ok, dist] = [dx < -4, -dx + Math.abs(dy) * 2];
      if (dir === 'right') [ok, dist] = [dx > 4, dx + Math.abs(dy) * 2];
      if (dir === 'up') [ok, dist] = [dy < -4, -dy + Math.abs(dx) * 2];
      if (dir === 'down') [ok, dist] = [dy > 4, dy + Math.abs(dx) * 2];
      if (ok && dist < bestD) {
        bestD = dist;
        best = k;
      }
    }
    if (!best && (dir === 'left' || dir === 'right')) {
      const i = cards.findIndex(([k]) => k === card);
      best = cards[(i + (dir === 'right' ? 1 : -1) + cards.length) % cards.length]![0];
    }
    if (best) {
      setCard(best);
      cardRefs.current.get(best)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  };
  useAppKeyboard((e) => {
    onKey(e);
    return e.defaultPrevented;
  }, { enabled: !drawer, priority: ROUTE_DECISION_PRIORITY });

  // ── Header ──────────────────────────────────────────────────
  const counts = useMemo(() => ledgerCounts(contests), [contests]);
  const subtitle = contests.length === 0
    ? [L.subtitle_empty]
    : [
        <Rich key="all" template={contests.length === 1 ? L.subtitle_since_one : L.subtitle_since_other} values={{ count: <b>{contests.length}</b>, date: counts.since ? formatDay(counts.since, language) : '' }} />,
        counts.running ? tx(L.subtitle_running, { count: counts.running }) : null,
        tx(counts.review === 1 ? L.subtitle_need_one : L.subtitle_need_other, { count: counts.review }),
        counts.scheduled ? tx(L.subtitle_scheduled, { count: counts.scheduled }) : null,
        tx(L.subtitle_decided, { count: counts.decided }),
      ].filter(Boolean);

  const mainWidth = Math.max(0, (stageRef.current?.clientWidth ?? rootSize.width) - (wide ? 312 : 268) - 40);
  const hasDetail = !!detail && !!summary && keyOf(detail.summary) === keyOf(summary);
  const readinessProject = summary?.projectId ?? activeProjectId ?? null;

  return (
    <div ref={rootRef} className={`contest-ledger sl${wide ? ' wide' : ''}`} data-testid="contest-ledger">
      <ContentHeader
        icon={<Trophy className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title={s.page_title}
        compact
        subtitle={
          <span data-testid="ledger-subtitle">
            {subtitle.map((part, i) => (
              <span key={i}>
                {i > 0 && <span className="sep">·</span>}
                {part}
              </span>
            ))}
          </span>
        }
        actions={
            <div className="sl-hact">
              <label className="sl-search">
                <Search className="w-4 h-4 shrink-0" aria-hidden />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  placeholder={L.search_placeholder}
                  aria-label={L.search_label}
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={() => {
                    if (level !== 1) go(1, null);
                  }}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setQuery('');
                      e.currentTarget.blur();
                    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      e.currentTarget.blur();
                      const first = order[0];
                      if (first) {
                        setFocusKey(first);
                        if (e.key === 'Enter' && order.length === 1) openContest(first, rowRefs.current.get(first) ?? null);
                      }
                    }
                  }}
                  data-testid="ledger-search"
                />
                <Kbd>/</Kbd>
              </label>
              <Button variant="secondary" className="cl-btn" icon={<ListOrdered className="w-4 h-4" />} onClick={() => setDrawer('standings')} data-testid="ledger-standings">
                {L.standings}
                <Kbd>S</Kbd>
              </Button>
              <Button variant="primary" className="cl-btn cl-primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawer('setup')} data-testid="ledger-new-contest">
                {L.new_contest}
                <Kbd>N</Kbd>
              </Button>
            </div>
        }
      />
      <ReadinessStrip projectId={readinessProject} className="mx-5 mt-2.5" />
      <div className="sl-stage" ref={stageRef}>
        <section ref={levelRefs[1]} className="lv lv1" aria-label={L.ledger_label} hidden={level !== 1 && leaving !== 1}>
          <LedgerLevel
            contests={contests}
            groups={ledgerWindow.window.groups}
            pager={ledgerWindow.pager}
            hasEntered={enter.hasEntered}
            markEntered={enter.markEntered}
            isLoading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refresh()}
            filter={filter}
            query={query}
            onFilter={setFilter}
            onClear={() => {
              setFilter(null);
              setQuery('');
            }}
            focusKey={focusKey}
            onOpen={openContest}
            onFocusRow={setFocusKey}
            onStandings={() => setDrawer('standings')}
            onNewContest={() => setDrawer('setup')}
            rowRefs={rowRefs}
            nowMs={nowMs}
            wide={wide}
          />
        </section>
        {summary && (level >= 2 || leaving === 2) && (
          <section ref={levelRefs[2]} className="lv lv2" aria-label={summary.title} hidden={level !== 2 && leaving !== 2}>
            <ContestLevel
              summary={summary}
              detail={hasDetail ? detail : null}
              detailError={detailError}
              draft={draft}
              contests={contests}
              card={card}
              onCard={setCard}
              onSort={sort}
              onOpenVariant={openVariant}
              onOpenContest={(k) => openContest(k, null)}
              onBack={backToLedger}
              cardRefs={cardRefs}
              nowMs={nowMs}
              wide={wide}
              mainWidth={mainWidth}
            />
          </section>
        )}
        {summary && hasDetail && vkey && (level === 3 || leaving === 3) && (
          <section ref={levelRefs[3]} className="lv lv3" aria-label={tx(L.variant_key, { key: vkey })} hidden={level !== 3 && leaving !== 3}>
            <VariantLevel
              summary={summary}
              detail={detail!}
              draft={draft}
              vkey={vkey}
              width={width}
              pinMode={pinMode}
              onWidth={setWidth}
              onPinMode={setPinMode}
              onStep={(d) => setVkey((cur) => stepKey((detail?.variants ?? []).map((v) => v.key), cur, d))}
              onSelect={setVkey}
              onSort={sort}
              onBackToContest={backToContest}
              onBackToLedger={backToLedger}
              noteRef={noteRef}
              s={s}
            />
          </section>
        )}
      </div>
      <footer className="sl-legend" aria-label={L.legend_label} data-testid="ledger-legend">
        <Legend level={level} drawer={drawer} summary={summary} hasVariants={!!detail?.variants.length} pinMode={pinMode} filtered={!!(filter || query)} count={contests.length} variantIndex={(detail?.variants ?? []).findIndex((v) => v.key === vkey)} variantCount={detail?.variants.length ?? 0} />
      </footer>

      {drawer === 'setup' && (
        <SetupDrawer
          contests={contests}
          defaultProjectId={summary?.projectId ?? activeProjectId ?? null}
          wide={wide}
          onClose={() => setDrawer(null)}
          onCreated={(created) => {
            setDrawer(null);
            setFilter(null);
            setQuery('');
            focusContest({ projectId: created.projectId, contestId: created.contestId });
          }}
        />
      )}
      {drawer === 'standings' && (
        <StandingsDrawer
          contests={contests}
          wide={wide}
          onClose={() => setDrawer(null)}
          onPick={(k) => {
            setDrawer(null);
            openContest(k, level === 1 ? rowRefs.current.get(k) ?? null : null);
          }}
        />
      )}
    </div>
  );
}

function Legend({ level, drawer, summary, hasVariants, pinMode, filtered, count, variantIndex, variantCount }: {
  level: Level;
  drawer: Drawer;
  summary: ContestSummary | null;
  hasVariants: boolean;
  pinMode: boolean;
  filtered: boolean;
  count: number;
  variantIndex: number;
  variantCount: number;
}) {
  const { t, tx } = useTranslation();
  const L = t.plugins.contest.ledger;
  const K = ({ k, label }: { k: string; label: string }) => (
    <span className="lg">
      <Kbd>{k}</Kbd>
      {label}
    </span>
  );
  if (drawer === 'setup') {
    return (
      <>
        <K k="↑↓" label={L.key_suggestions} />
        <K k="↵" label={L.key_add_seat} />
        <K k="Esc" label={L.key_close_setup} />
        <span className="where">{L.new_contest}</span>
      </>
    );
  }
  if (drawer === 'standings') {
    return (
      <>
        <K k="Esc" label={L.key_close_standings} />
        <span className="where">{L.standings}</span>
      </>
    );
  }
  if (level === 1) {
    return (
      <>
        <K k="↑↓" label={L.key_move} />
        <K k="↵" label={L.key_open_contest} />
        <K k="/" label={L.key_find} />
        <K k="N" label={L.new_contest} />
        <K k="S" label={L.standings} />
        {filtered && <K k="Esc" label={L.clear_filter} />}
        <span className="where">
          <List className="w-3.5 h-3.5" aria-hidden />
          <b>{L.where_ledger}</b> · {tx(L.where_count, { count })}
        </span>
      </>
    );
  }
  if (level === 2) {
    const editable = !!summary && isEditable(summary);
    return (
      <>
        {hasVariants && <K k="↑↓←→" label={L.key_move} />}
        {hasVariants && editable && <K k="1–4" label={L.key_sort} />}
        {hasVariants && editable && <K k="0" label={L.key_unsorted} />}
        {hasVariants && <K k="↵" label={L.key_open_variant} />}
        <K k="Esc" label={L.crumb_all} />
        {hasVariants && !editable && (
          <span className="lock">
            <Lock className="w-3.5 h-3.5" aria-hidden />
            {L.sorting_closed}
          </span>
        )}
        <span className="where">
          <Layers className="w-3.5 h-3.5" aria-hidden />
          <b>{L.where_contest}</b>
          {summary && ` · ${shortTitle(summary.title)}`}
        </span>
      </>
    );
  }
  return (
    <>
      {pinMode ? (
        <>
          <span className="lg">
            <MapPin className="w-3.5 h-3.5" aria-hidden />
            {L.key_pin_hint}
          </span>
          <K k="P" label={L.key_pin_off} />
          <K k="Esc" label={L.key_pin_off} />
        </>
      ) : (
        <>
          <K k="←→" label={L.key_prev_next} />
          <K k="1–4" label={L.key_sort} />
          <K k="0" label={L.key_clear} />
          <K k="P" label={L.key_pin} />
          <K k="N" label={L.key_note} />
          <K k="W" label={L.key_width} />
          <K k="Esc" label={L.key_back} />
        </>
      )}
      <span className="where">
        <Film className="w-3.5 h-3.5" aria-hidden />
        <b>{L.where_variant}</b> · {tx(L.counter, { i: variantIndex + 1, n: variantCount })}
      </span>
    </>
  );
}
