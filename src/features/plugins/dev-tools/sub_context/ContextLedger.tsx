// The Context Ledger — the Context Map's single surface (won the /prototype
// "Cross-tab" round; the stacked GroupList + UseCasePanel board it replaced is
// gone).
//
// Mental model: a spreadsheet cross-tabulation. Rows are contexts (wrapped in
// their group bands, like the Factory matrix); COLUMNS are the active use cases.
// A filled cell means "this use case slices through this context" — so you read
// DOWN a column to see a use case's whole slice, and ACROSS a row to see which
// use cases touch a context. The N:M relationship becomes a shape you can see
// at a glance instead of a set of chips you have to cross-reference. The left
// gutter carries each context's real coverage (files · use cases · goals ·
// ideas · KPIs) so a row is a full record, not just a label — and the goal /
// idea counts click through to their surfaces.
import { useMemo, useState } from 'react';
import { Layers, Search, Sparkles, X, Plus, FolderTree } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import GroupColorPicker, { colorDot } from './GroupColorPicker';
import {
  ContextCoverage,
  LedgerActions,
  ProposalStrip,
  kindMeta,
  KIND_DOT,
  KIND_TEXT,
  type ContextLedgerProps,
} from './contextLedgerShared';

export default function ContextLedger(props: ContextLedgerProps) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.plugins.dev_tools;
  const {
    groups,
    useCaseState,
    selectedUseCaseId,
    onSelectUseCase,
    selectedCtxId,
    onSelectCtx,
    goalCoverageByContext,
    ideaCoverageByContext,
    kpiCoverageByContext,
    hasMap,
    onScanContext,
    scanningContextId,
    scanBusy,
    showNewGroup,
    onShowNewGroup,
    onCreateGroup,
    onScan,
  } = props;

  const [query, setQuery] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('amber');

  const handleCreateGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    onCreateGroup(name, newGroupColor);
    setNewGroupName('');
    onShowNewGroup(false);
  };

  const cols = useCaseState.active;
  // Fast membership test per (useCase, context).
  const memberSets = useMemo(
    () => cols.map((uc) => ({ uc, set: new Set(uc.context_ids) })),
    [cols],
  );

  // Filter contexts by name / keyword; drop groups that end up empty. A trimmed
  // empty query is the no-op identity so the common case does no work.
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        contexts: g.contexts.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.keywords.some((k) => k.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.contexts.length > 0);
  }, [groups, query]);

  // contextId → name, for the proposal detail modal's spanned-context list.
  const contextNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const c of g.contexts) m.set(c.id, c.name);
    return m;
  }, [groups]);

  // Grid: context record (name + coverage) then one narrow column per use case.
  const gridTemplate = `minmax(280px, 1.6fr) repeat(${cols.length}, 34px)`;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* header — title · search · use-case actions */}
      <div className="flex items-center gap-2 mb-2">
        <h3 className="typo-section-title flex items-center gap-1.5 shrink-0">
          <Layers className="w-3.5 h-3.5 text-primary" />
          {t.uc_title}
          {cols.length > 0 && (
            <span className="typo-caption text-foreground tabular-nums">({cols.length})</span>
          )}
        </h3>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.context_search_placeholder}
            className={`${INPUT_FIELD} !py-1 !pl-8 !text-sm`}
            aria-label={t.context_search_placeholder}
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <LedgerActions state={useCaseState} hasMap={hasMap} t={t} />
        </div>
      </div>

      <ProposalStrip
        proposals={useCaseState.proposed}
        onAccept={useCaseState.accept}
        onReject={useCaseState.reject}
        contextNames={contextNames}
        t={t}
        tx={tx}
      />

      {/* inline new-group form — opened by the page's "+ Group" action */}
      {showNewGroup && (
        <div className="animate-fade-slide-in mb-2 border border-primary/10 rounded-modal p-3 bg-primary/5 space-y-2.5">
          <div className="flex items-center gap-2">
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
              placeholder={t.group_name_placeholder}
              className={INPUT_FIELD}
              autoFocus
            />
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              disabled={!newGroupName.trim()}
              onClick={handleCreateGroup}
            >
              {t.create}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => onShowNewGroup(false)} aria-label={tRoot.common.cancel}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <GroupColorPicker selectedColor={newGroupColor} onChange={setNewGroupColor} />
        </div>
      )}

      {/* nothing mapped yet — scan, or hand-author a group */}
      {groups.length === 0 && !showNewGroup ? (
        <div className="flex flex-col items-center text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-3">
            <FolderTree className="w-7 h-7 text-amber-400/50" />
          </div>
          <p className="typo-body text-foreground mb-1">{t.no_context_groups}</p>
          <p className="typo-caption text-foreground/60 mb-4">{t.scan_or_create}</p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => onShowNewGroup(true)}>
              {t.add_group}
            </Button>
            <Button variant="accent" accentColor="amber" size="sm" icon={<Search className="w-3.5 h-3.5" />} onClick={onScan}>
              {t.scan_codebase}
            </Button>
          </div>
        </div>
      ) : (
      <div className="rounded-card border border-primary/10 overflow-auto min-h-0 flex-1">
        {/* column header — one clickable cell per use case */}
        <div
          className="grid items-end gap-0 px-3 py-2 bg-secondary/20 border-b border-primary/10 sticky top-0 z-10 backdrop-blur"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span className="typo-label text-foreground/60">{t.context_column_label}</span>
          {cols.length === 0 ? (
            <span className="typo-caption text-foreground/40 pl-2">—</span>
          ) : (
            memberSets.map(({ uc }) => {
              const meta = kindMeta(uc.kind);
              const Icon = meta.icon;
              const selected = uc.id === selectedUseCaseId;
              return (
                <Tooltip key={uc.id} content={`${uc.name} · ${tx(t.uc_span_count, { count: uc.context_ids.length })}`}>
                  <button
                    type="button"
                    onClick={() => onSelectUseCase(selected ? null : uc.id)}
                    aria-pressed={selected}
                    className={`h-full flex items-start justify-center pt-0.5 rounded-t transition-colors ${
                      selected ? 'bg-primary/15' : 'hover:bg-secondary/40'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${KIND_TEXT[meta.stem]}`} />
                  </button>
                </Tooltip>
              );
            })
          )}
        </div>

        {/* group bands + context rows */}
        {filteredGroups.map((g) => {
          const dot = colorDot(g.color);
          return (
            <div key={g.id}>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/10 border-b border-primary/5">
                <span className={`w-2.5 h-2.5 rounded-full ${dot.bg}`} />
                <span className="typo-title">{g.name}</span>
                <span className="typo-caption text-foreground/50 tabular-nums">{g.contexts.length}</span>
              </div>

              <div className="divide-y divide-primary/5">
                {g.contexts.map((c) => {
                  const selected = c.id === selectedCtxId;
                  return (
                    <div
                      key={c.id}
                      className={`grid items-center gap-0 px-3 py-1 transition-colors ${
                        selected ? 'bg-primary/10' : 'hover:bg-secondary/10'
                      }`}
                      style={{ gridTemplateColumns: gridTemplate }}
                    >
                      {/* the context record */}
                      <div className="flex items-center gap-2.5 min-w-0 pr-3">
                        {c.pinned && (
                          <span className="w-1 h-3.5 rounded-full bg-amber-400/70 shrink-0" title={t.context_pinned} />
                        )}
                        <button
                          type="button"
                          onClick={() => onSelectCtx(selected ? null : c.id)}
                          className="typo-body font-medium text-foreground truncate text-left hover:text-primary"
                        >
                          {c.name}
                        </button>
                        <span className="ml-auto shrink-0">
                          <ContextCoverage
                            fileCount={c.filePaths.length}
                            useCaseCount={memberSets.filter((m) => m.set.has(c.id)).length}
                            goalCount={goalCoverageByContext.get(c.id)?.count ?? 0}
                            firstGoalId={goalCoverageByContext.get(c.id)?.firstGoalId}
                            ideaCount={ideaCoverageByContext.get(c.id) ?? 0}
                            kpiCount={kpiCoverageByContext.get(c.id) ?? 0}
                            t={t}
                          />
                        </span>
                        <Tooltip content={t.context_scan_ideas_tooltip}>
                          <button
                            type="button"
                            onClick={() => { if (!scanBusy) onScanContext(c.id); }}
                            disabled={scanBusy}
                            aria-label={t.context_scan_ideas_tooltip}
                            className="shrink-0 grid place-items-center w-6 h-6 rounded-full border border-primary/15 bg-primary/5 text-foreground hover:bg-primary/10 hover:border-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {scanningContextId === c.id ? <LoadingSpinner size="xs" /> : <Sparkles className="w-3 h-3" />}
                          </button>
                        </Tooltip>
                      </div>

                      {/* membership cells */}
                      {memberSets.map(({ uc, set }) => {
                        const isMember = set.has(c.id);
                        const isPrimary = uc.primary_context_id === c.id;
                        const meta = kindMeta(uc.kind);
                        const colSelected = uc.id === selectedUseCaseId;
                        return (
                          <span
                            key={uc.id}
                            className={`flex items-center justify-center h-full ${colSelected ? 'bg-primary/[0.07]' : ''}`}
                          >
                            {isMember ? (
                              <span
                                className={`rounded-full ${KIND_DOT[meta.stem]} ${
                                  isPrimary ? 'w-2.5 h-2.5 ring-2 ring-offset-1 ring-offset-transparent ring-primary/40' : 'w-2 h-2 opacity-80'
                                }`}
                              />
                            ) : (
                              <span className="w-1 h-1 rounded-full bg-foreground/10" />
                            )}
                          </span>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {query.trim() && filteredGroups.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center px-6">
            <Search className="w-6 h-6 text-foreground/30" />
            <p className="typo-caption text-foreground/60">
              {t.context_search_no_results} “{query.trim()}”
            </p>
          </div>
        )}

        {cols.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center px-6">
            <Layers className="w-7 h-7 text-primary/40" />
            <p className="typo-body font-medium text-foreground">{t.uc_empty}</p>
            <p className="typo-caption text-foreground/60 max-w-sm">
              {hasMap ? t.uc_scan_tooltip : t.uc_empty_no_map}
            </p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
