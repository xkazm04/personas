/**
 * Gate K prototype: Fleet Activity composed from the A/3 "Spine & Lens" kit
 * (`src/features/shared/components/kit-proto/spine/`), as the contest entry composed it:
 * Overview, Sessions and Tools on one spine, the selection's detail in a side pane when the
 * surface has room and in a drawer when it has not.
 *
 * Beyond `ActivityKitProps` it reads the registry sessions (`fleetSessions`) the page already
 * derives `liveSessionIds` from, because the variant's marks, state filter and titles are a
 * transcript's live session state and title (its model.js makes the same join).
 *
 * Keys (route rung of the app keyboard ladder, never while typing or over a dialog): j/k and
 * arrows move the selection, Enter opens it, Esc closes the drawer, / focuses the search.
 * Not carried: the variant's shell keys (1-5, [ ], L, T), which belong to its page chrome.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';
import { ChipRow, Drawer, KitHost, Section, Split, Surface } from '@/features/shared/components/kit-proto/spine';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { ActivityKitProps } from './kitProto';
import { toSpineSession, totalsOf, type SpineSession } from './activitySpineModel';
import { useSpineWords } from './useSpineWords';
import { ActivitySpineOverview } from './ActivitySpineOverview';
import { ActivitySpineSessions, type StateFilter } from './ActivitySpineSessions';
import { ActivitySpineDetail } from './ActivitySpineDetail';

export default function ActivitySpine({ rows, filtered, loading, failed, query, setQuery, onRefresh, onOpen, liveSessionIds }: ActivityKitProps) {
  const w = useSpineWords();
  const fleet = useSystemStore((st) => st.fleetSessions);
  const [sel, setSel] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [tool, setTool] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(fleet.filter((s) => s.claudeSessionId).map((s) => [s.claudeSessionId!, s])), [fleet]);
  const all = useMemo(() => rows.map((r) => toSpineSession(r, byId.get(r.claudeSessionId))), [rows, byId]);
  const totals = useMemo(() => totalsOf(all), [all]);
  const shown = useMemo(() => {
    const keep = new Set(filtered.map((r) => r.claudeSessionId));
    return all.filter((s) => keep.has(s.id)
      && (stateFilter === 'all' || s.state === stateFilter)
      && (!tool || s.row.tools.some((x) => x.name === tool)));
  }, [all, filtered, stateFilter, tool]);
  const selected = all.find((s) => s.id === sel) ?? null;

  // The variant arrives with the first session selected, so the detail is never blank.
  useEffect(() => { if (sel === null && all[0]) setSel(all[0].id); }, [all, sel]);

  const select = useCallback((id: string, fromKey = false) => {
    setSel(id);
    const row = Array.from(hostRef.current?.querySelectorAll<HTMLElement>('tr[data-id]') ?? []).find((el) => el.dataset.id === id);
    if (fromKey) { row?.focus({ preventScroll: true }); row?.scrollIntoView?.({ block: 'nearest' }); }
    // No room for the side pane: the detail opens in the drawer, as the variant does on a click.
    if (!fromKey && paneRef.current && paneRef.current.offsetWidth === 0) setDrawer(true);
  }, []);
  const open = useCallback((s: SpineSession) => onOpen(s.row), [onOpen]);
  const clearFilters = useCallback(() => { setStateFilter('all'); setTool(null); setQuery(''); }, [setQuery]);

  useAppKeyboard((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return false;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('[role="dialog"], button, a, select, [role="listbox"]')) return false;
    if (e.key === 'Escape' && drawer) { setDrawer(false); return true; }
    if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return true; }
    if (e.key === 'Enter' && selected) { e.preventDefault(); open(selected); return true; }
    const delta = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta || shown.length === 0) return false;
    e.preventDefault();
    const i = shown.findIndex((s) => s.id === sel);
    select(shown[Math.max(0, Math.min(shown.length - 1, i < 0 ? 0 : i + delta))]!.id, true);
    return true;
  }, { priority: ROUTE_DECISION_PRIORITY });

  const detail = (
    <ActivitySpineDetail s={selected} live={!!selected && liveSessionIds.has(selected.id)} onOpen={open} w={w} />
  );
  const top = totals.tools[0]?.count ?? 1;
  return (
    <div ref={hostRef}>
      <KitHost compact testId="kit-proto-spine">
        <Split
          paneRef={paneRef}
          paneLabel={w.f.insights_title}
          pane={detail}
          main={
            <Surface dense>
              <ActivitySpineOverview sessions={all} totals={totals} fleet={fleet} loading={loading && rows.length === 0} w={w} />
              <ActivitySpineSessions
                all={all} shown={shown} selected={sel} loading={loading} failed={failed}
                stateFilter={stateFilter} setStateFilter={setStateFilter}
                tool={tool} clearTool={() => setTool(null)} query={query} setQuery={setQuery}
                clearFilters={clearFilters} onRefresh={onRefresh} onSelect={select} searchRef={searchRef} w={w}
              />
              <Section
                id="s-fa-tools"
                eyebrow={w.eyebrow}
                title={w.t.common.tools}
                count={totals.tools.length}
                meta={<><Numeric value={totals.toolCalls} unit="count" /> {w.toolCalls.toLowerCase()}</>}
              >
                <ChipRow
                  label={w.f.insights_tools}
                  emptyLabel={w.f.insights_no_tools}
                  state={loading && rows.length === 0 ? 'loading' : undefined}
                  chips={totals.tools.map((x) => ({
                    id: x.name, label: x.name, count: x.count, share: x.count / top,
                    state: tool === x.name ? 'selected' : 'default',
                    onPress: () => setTool((cur) => (cur === x.name ? null : x.name)),
                  }))}
                />
              </Section>
            </Surface>
          }
        />
        <Drawer open={drawer} onClose={() => setDrawer(false)} closeLabel={w.t.common.close} label={w.f.insights_title}>
          {detail}
        </Drawer>
      </KitHost>
    </div>
  );
}
