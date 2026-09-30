/**
 * Observability (composition kit): the health issues as a DataTable. A row's state is its Mark
 * (issueModel), its name is the issue title, its meta the state word, category, persona and
 * where it came from. A click selects (the detail opens in the side pane or the drawer), Enter
 * opens the full issue, and Resolve stays one click away on every open row.
 */
import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { DataTable, KitButton, Meta, type EmptySpec, type TableRow } from '@/features/shared/components/kit';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import { ISSUE_GLYPH, canResolve, issueRowStates, issueState } from '../libs/issueModel';
import type { ObservabilityWords } from '../libs/useObservabilityWords';

type Col = 'issue' | 'age' | 'act';
const PAGE_SIZE = 20;
const stop = (e: MouseEvent) => e.stopPropagation();

interface IssuesListProps {
  issues: PersonaHealingIssue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (issue: PersonaHealingIssue) => void;
  onResolve: (id: string) => void;
  personaName: (id: string) => string | null;
  empty: EmptySpec;
  w: ObservabilityWords;
}

export function IssuesList({ issues, selectedId, onSelect, onOpen, onResolve, personaName, empty, w }: IssuesListProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // A filter that shortens the list starts it again from the first page.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [issues]);
  const visible = useMemo(() => issues.slice(0, visibleCount), [issues, visibleCount]);

  const rows: Array<TableRow<Col>> = visible.map((issue) => {
    const s = issueState(issue);
    const muted = s === 'fixed' || s === 'resolved';
    return {
      id: issue.id,
      state: issueRowStates(s, issue.id === selectedId),
      mark: { ...ISSUE_GLYPH[s], label: w.state[s] },
      cells: {
        issue: (
          <div className="k-cell2">
            <span className={`k-row__name typo-body ${muted ? 'k-regular' : 'k-strong'}`}>{issue.title}</span>
            <span className="k-row__meta typo-caption">
              <Meta parts={[w.state[s], issue.category, personaName(issue.persona_id), issue.source ? w.source[issue.source] : null]} />
            </span>
          </div>
        ),
        age: <span className="typo-data k-regular k-quiet"><RelativeTime timestamp={issue.created_at} format="elapsed" showTooltip={false} /></span>,
        act: canResolve(s) ? (
          <span className="contents" onClick={stop}>
            <KitButton quiet onClick={() => onResolve(issue.id)} testId="obs-issue-resolve">{w.t.common.resolve}</KitButton>
          </span>
        ) : null,
      },
    };
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (visible.length === 0 || e.target instanceof HTMLButtonElement) return;
    const i = visible.findIndex((x) => x.id === selectedId);
    if (e.key === 'Enter' && i >= 0) { e.preventDefault(); onOpen(visible[i]!); return; }
    const delta = e.key === 'ArrowDown' || e.key === 'j' ? 1 : e.key === 'ArrowUp' || e.key === 'k' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = visible[Math.max(0, Math.min(visible.length - 1, i < 0 ? 0 : i + delta))]!;
    onSelect(next.id);
    const row = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`tr[data-id="${next.id}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: 'nearest' });
  };

  return (
    <div onKeyDown={onKeyDown}>
      <DataTable<Col>
        label={w.o.healing_issues_panel.title}
        onRowClick={onSelect}
        rowTestId="obs-issue-row"
        testId="obs-issue-list"
        cols={[
          { key: 'issue', label: w.o.observability_extra.healing_issues },
          { key: 'age', label: w.o.incidents.ledger.col_age, num: true },
          { key: 'act', label: '', num: true },
        ]}
        rows={rows}
        empty={empty}
        pager={issues.length > visibleCount ? (
          <>
            <span className="typo-data k-regular k-quiet">{visible.length} / {issues.length}</span>
            <KitButton onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>{w.o.activity.load_more}</KitButton>
          </>
        ) : undefined}
      />
    </div>
  );
}
