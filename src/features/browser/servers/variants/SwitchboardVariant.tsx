/**
 * Server control prototype: Switchboard. A compact, keyboard-first console:
 * four big numbers over one dense row per app, grouped by workspace under thin
 * labelled rails. Arrow keys move between rows, Space or Enter toggles, the Menu
 * key (or Shift+F10) opens the shared menu at the row. Built to stay the most
 * efficient layout at 20+ apps. Owns presentation only; see `../serverVariantProps.ts`.
 */
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Ghost, KitHost } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import { groupByWorkspace, useNowSeconds, useWorkspaceIndex } from '../serverModel';
import type { ServerVariantProps } from '../serverVariantProps';
import { SwitchboardRow } from './switchboard/SwitchboardRow';
import { SwitchboardSummary } from './switchboard/SwitchboardSummary';
import { isInert, isMenuChord, stepIndex, summarize } from './switchboard/switchboardModel';
import './switchboard/switchboard.css';

export default function SwitchboardVariant({ servers, loading, hostPort, onMenu, onToggle }: ServerVariantProps) {
  const { t } = useTranslation();
  const sb = t.browser.servers.switchboard;
  const workspaces = useWorkspaceIndex();
  /** Rows in display order: workspace runs kept together (grouping keeps the list's own order). */
  const ordered = useMemo(() => groupByWorkspace(servers).flatMap((g) => g.servers), [servers]);
  const summary = useMemo(() => summarize(servers), [servers]);
  const now = useNowSeconds(servers.some((s) => s.startedAt != null));

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = Math.max(0, ordered.findIndex((s) => s.projectId === activeId));
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const focusRow = useCallback((server: DevServerView | undefined) => {
    if (!server) return;
    setActiveId(server.projectId);
    rowRefs.current.get(server.projectId)?.focus();
  }, []);

  const onRowKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, server: DevServerView, index: number) => {
      const next = stepIndex(e.key, index, ordered.length);
      if (next != null) {
        e.preventDefault();
        focusRow(ordered[next]);
        return;
      }
      if (isMenuChord(e)) {
        // The menu opens where the row is, as a right-click would: dispatching a real
        // contextmenu event keeps ONE path into `onMenu` with real coordinates.
        e.preventDefault();
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 96, clientY: r.bottom }));
        return;
      }
      if ((e.key === ' ' || e.key === 'Enter') && e.target === e.currentTarget) {
        e.preventDefault();
        if (!isInert(server, hostPort)) onToggle(server);
      }
    },
    [ordered, focusRow, hostPort, onToggle],
  );

  if (loading) return <SwitchboardGhost />;

  return (
    <div className="sb-root" data-testid="switchboard">
      <KitHost>
        <SwitchboardSummary summary={summary} loading={false} />
        <div role="list" aria-label={sb.list_label} className="sb-list">
          <ColumnHeads />
          {ordered.map((server, index) => {
            // The workspace is a column, not a heading row: its name labels the first
            // row of each run and its colour paints a rail down the run. Twenty apps in
            // five workspaces stay twenty rows, not twenty-five.
            const ws = server.workspaceId ? workspaces.get(server.workspaceId) : undefined;
            const groupStart = index === 0 || ordered[index - 1]!.workspaceId !== server.workspaceId;
            return (
              <SwitchboardRow
                key={server.projectId}
                ref={(el) => {
                  if (el) rowRefs.current.set(server.projectId, el);
                  else rowRefs.current.delete(server.projectId);
                }}
                server={server}
                hostPort={hostPort}
                now={now}
                workspace={{ name: ws?.name ?? sb.no_workspace, color: ws?.color ?? null }}
                groupStart={groupStart}
                active={index === activeIndex}
                onFocusRow={() => setActiveId(server.projectId)}
                onKeyDown={(e) => onRowKey(e, server, index)}
                onMenu={onMenu}
                onToggle={onToggle}
              />
            );
          })}
        </div>
      </KitHost>
    </div>
  );
}

/** The column heads, aligned to the row grid; a reader hears each row's own label instead. */
function ColumnHeads() {
  const { t } = useTranslation();
  const s = t.browser.servers;
  const sb = s.switchboard;
  return (
    <div className="sb-row sb-heads" aria-hidden>
      <span className="typo-label">{sb.col_workspace}</span>
      <span />
      <span className="typo-label">{s.port_label}</span>
      <span className="typo-label">{sb.col_app}</span>
      <span className="typo-label">{sb.col_state}</span>
      <span className="typo-label">{s.tech_label}</span>
      <span className="typo-label">{sb.col_detail}</span>
      <span className="typo-label">{s.command_label}</span>
    </div>
  );
}

/** First load: the console's own shape in ghost, under the section chrome. */
function SwitchboardGhost() {
  const { t } = useTranslation();
  const sb = t.browser.servers.switchboard;
  return (
    <div className="sb-root" aria-busy="true" aria-label={sb.loading_label} data-testid="switchboard-loading">
      <KitHost>
        <SwitchboardSummary summary={summarize([])} loading />
        <div className="sb-list" aria-hidden>
          {[62, 48, 70, 40, 56, 52].map((w, i) => (
            <div key={i} className="sb-row is-ghost">
              <Ghost width="70%" />
              <Ghost width="40px" height="20px" />
              <Ghost width="40px" />
              <Ghost width={`${w}%`} />
              <Ghost width="70%" />
              <Ghost width="60%" />
              <Ghost width="50%" />
              <Ghost width={`${w + 10}%`} />
            </div>
          ))}
        </div>
      </KitHost>
    </div>
  );
}
