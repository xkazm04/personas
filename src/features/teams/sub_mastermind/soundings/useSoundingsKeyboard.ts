// Soundings — THE KEY GRAMMAR. Arrows walk, Enter descends, Escape rises, and
// the single letters are the chart's verbs: A the agent waiting for you, R the
// next related project, I the project file, H home.
//
// Extracted from SoundingsView 2026-10-06. It takes the model rather than
// twenty arguments, which is also what keeps the two memo'd steppers (relStep,
// awaitingStep) next to the handler that calls them.
import { useCallback, useRef } from 'react';

import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import { spatialMove, type ArrowKey } from './soundingsGeometry';
import { relatedStations } from './soundingsModel';
import type { SoundingsModel } from './useSoundings';
import { FILE } from './useSoundingsNav';

export function useSoundingsKeyboard(model: SoundingsModel) {
  const { stations, n, edges, indexOf, rank, rankOf, nav, geo, words } = model;
  const { m, tx } = words;
  const {
    level, cur, focus, readKey, lift, marked, jumpOpen, helpOpen,
    setFocusSlug, setReadKey, setMarked, setFlash, setJumpOpen, setHelpOpen,
    goL0, goL1, openCard, closeCard, goDim, toggleFile, say, later, wantFocus, rootRef,
  } = nav;
  const { column } = geo;

  /** R: step through the projects this one is joined to, remembering the origin
   *  so repeated presses walk the ring instead of ping-ponging. */
  const relMemo = useRef<{ origin: number; k: number; at: number } | null>(null);
  const relStep = useCallback(() => {
    const here = level === 0 ? focus : cur ?? focus;
    const origin = relMemo.current && relMemo.current.at === here ? relMemo.current.origin : here;
    const rel = relatedStations(origin, edges, indexOf);
    const from = stations[origin];
    if (!from) return;
    if (!rel.length) { say('chart', tx(m.soundings_log_no_currents, { name: from.island.name })); return; }
    const k = relMemo.current && relMemo.current.origin === origin ? (relMemo.current.k + 1) % rel.length : 0;
    const to = rel[k]!;
    relMemo.current = { origin, k, at: to };
    if (level === 0) { setFocusSlug(stations[to]!.island.slug); wantFocus.current = true; }
    else if (level === 1) goL1(to);
    else goDim(to, lift?.key ?? FILE);
    const edge = edges.find((e) => (indexOf.get(e.from) === origin && indexOf.get(e.to) === to) || (indexOf.get(e.to) === origin && indexOf.get(e.from) === to));
    const params = { from: from.island.name, to: stations[to]!.island.name, label: edge?.label ?? '' };
    say('chart', edge?.label ? tx(m.soundings_log_current_label, params) : tx(m.soundings_log_current, params));
  }, [level, focus, cur, edges, indexOf, stations, say, tx, m, goL1, goDim, lift, setFocusSlug, wantFocus]);

  /** A: the next fleet session that is waiting on the owner, anywhere. */
  const awIdx = useRef(-1);
  const awaitingStep = useCallback(() => {
    const list = stations.flatMap((s) => s.island.fleet.filter((f) => f.state === 'awaiting_input').map((f) => ({ i: s.index, f })));
    if (!list.length) { say('chart', m.soundings_log_none_waiting); return; }
    awIdx.current = (awIdx.current + 1) % list.length;
    const { i, f } = list[awIdx.current]!;
    if (!(level === 1 && cur === i)) goL1(i);
    setFlash(f.id);
    later(() => setFlash((x) => (x === f.id ? null : x)), 2400);
    say('chart', tx(m.soundings_log_waiting, { session: f.label, name: stations[i]!.island.name }));
  }, [stations, level, cur, goL1, later, say, tx, m, setFlash]);

  useAppKeyboard((e) => {
    if (jumpOpen || helpOpen) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return false;
    // Only while the owner is in the chart: keys typed into another panel are not ours.
    const ae = document.activeElement;
    if (ae && ae !== document.body && !rootRef.current?.contains(ae)) return false;
    if (n === 0) return false;
    const k = e.key;
    if (k !== 'r' && k !== 'R' && k !== 'Shift') relMemo.current = null;

    if (k.startsWith('Arrow')) {
      e.preventDefault();
      const dir = k as ArrowKey;
      if (level === 0) {
        // Left/right walk the fixed order; up/down walk the urgency ranking.
        const byRank = () => rank[Math.max(0, Math.min(n - 1, rankOf(focus) + (dir === 'ArrowUp' ? -1 : 1)))] ?? focus;
        const next = dir === 'ArrowLeft' ? Math.max(0, focus - 1) : dir === 'ArrowRight' ? Math.min(n - 1, focus + 1) : byRank();
        setFocusSlug(stations[next]!.island.slug);
        wantFocus.current = true;
        return true;
      }
      if (e.shiftKey && (dir === 'ArrowLeft' || dir === 'ArrowRight') && cur !== null) {
        const to = Math.max(0, Math.min(n - 1, cur + (dir === 'ArrowLeft' ? -1 : 1)));
        if (to !== cur) { if (level === 2) goDim(to, lift?.key ?? FILE); else goL1(to); }
        return true;
      }
      if (column && readKey) {
        const nk = spatialMove(column.frames, readKey, dir);
        if (nk) {
          if (level === 2) openCard(nk);
          else { setReadKey(nk); wantFocus.current = true; }
        }
      }
      return true;
    }
    if (k === 'Enter') {
      if (ae instanceof HTMLButtonElement && !ae.dataset.sd) return false; // a real button: let it click
      e.preventDefault();
      if (level === 0) goL1(focus);
      else if (level === 1 && readKey) openCard(readKey);
      return true;
    }
    if (k === 'Escape') {
      if (level === 2) { closeCard(); return true; }
      if (level === 1) { goL0(); return true; }
      if (marked.size) { setMarked(new Set()); return true; }
      return false;
    }
    if (k === '/') { e.preventDefault(); setJumpOpen(true); return true; }
    if (k === '?') { e.preventDefault(); setHelpOpen(true); return true; }
    const lk = k.toLowerCase();
    if (lk === 'a') { awaitingStep(); return true; }
    if (lk === 'r') { relStep(); return true; }
    if (lk === 'i') { toggleFile(); return true; }
    if (lk === 'h' || k === 'Home') { e.preventDefault(); goL0(); return true; }
    return false;
  }, { priority: ROUTE_DECISION_PRIORITY });
}
