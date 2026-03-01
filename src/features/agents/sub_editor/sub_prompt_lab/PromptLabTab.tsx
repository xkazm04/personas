import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GitBranch, FlaskConical,
  Shield, ArrowLeftRight, Loader2, TrendingUp,
  ArrowUpDown, ChevronDown, ChevronRight,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import {
  getPromptVersions,
  tagPromptVersion,
  rollbackPromptVersion,
} from '@/api/observability';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import { VersionItem, type VersionAction } from './prompt-lab/VersionItem';
import { DiffViewer } from './prompt-lab/DiffViewer';
import { AbTestPanel } from './prompt-lab/AbTestPanel';
import { AutoRollbackSettings } from './prompt-lab/AutoRollbackSettings';
import { PromptPerformanceDashboard } from './prompt-lab/PromptPerformanceDashboard';
import { filterSortGroup, type TagFilter, type SortOrder, type DateGroup } from './prompt-lab/promptLabUtils';

export function PromptLabTab() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const [versions, setVersions] = useState<PersonaPromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareAId, setCompareAId] = useState<string | null>(null);
  const [compareBId, setCompareBId] = useState<string | null>(null);
  // Per-version operation tracking: versionId -> which action is in-flight
  const [busyVersions, setBusyVersions] = useState<Record<string, VersionAction>>({});
  // Per-version inline errors: versionId -> error message
  const [versionErrors, setVersionErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);
  const [activePanel, setActivePanel] = useState<'diff' | 'ab-test' | 'rollback' | 'performance'>('diff');
  const [tagFilter, setTagFilter] = useState<TagFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<DateGroup>>(new Set());

  const personaId = selectedPersona?.id;

  // Sequence counter to discard stale fetch results from manual refetches
  // (handleTag / handleRollback). Incremented on every persona switch and
  // every manual refetch so only the most recent response is applied.
  const fetchSeqRef = useRef(0);

  const fetchVersions = useCallback(async (silent = false) => {
    if (!personaId) return;
    const seq = ++fetchSeqRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const vs = await getPromptVersions(personaId, 50);
      if (fetchSeqRef.current !== seq) return; // stale
      setVersions(vs);
    } catch (err) {
      if (fetchSeqRef.current !== seq) return;
      setError(err instanceof Error ? err.message : 'Failed to load prompt versions');
    } finally {
      if (fetchSeqRef.current === seq && !silent) setLoading(false);
    }
  }, [personaId]);

  // Reset stale state and fetch fresh versions when persona changes
  useEffect(() => {
    // Clear previous persona's state immediately so it's never shown during loading
    setVersions([]);
    setSelectedId(null);
    setCompareAId(null);
    setCompareBId(null);
    setError(null);
    setBusyVersions({});
    setVersionErrors({});
    fetchSeqRef.current++; // invalidate any in-flight fetches from previous persona
    void fetchVersions();
  }, [fetchVersions]);

  const compareA = useMemo(
    () => versions.find((v) => v.id === compareAId) ?? null,
    [versions, compareAId],
  );

  const compareB = useMemo(
    () => versions.find((v) => v.id === compareBId) ?? null,
    [versions, compareBId],
  );

  const grouped = useMemo(
    () => filterSortGroup(versions, tagFilter, sortOrder),
    [versions, tagFilter, sortOrder],
  );

  const filteredCount = useMemo(
    () => grouped.reduce((n, g) => n + g.versions.length, 0),
    [grouped],
  );

  const toggleGroupCollapse = (group: DateGroup) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const tagActionName = (tag: string): VersionAction => {
    if (tag === 'production') return 'promote';
    if (tag === 'archived') return 'archive';
    return 'unarchive';
  };

  const tagLabel = (tag: string): string => {
    if (tag === 'production') return 'Promoted to production';
    if (tag === 'archived') return 'Archived';
    return 'Unarchived';
  };

  const handleTag = async (versionId: string, tag: string) => {
    const action = tagActionName(tag);
    setBusyVersions((prev) => ({ ...prev, [versionId]: action }));
    setVersionErrors((prev) => { const next = { ...prev }; delete next[versionId]; return next; });
    try {
      await tagPromptVersion(versionId, tag);
      await fetchVersions(true);
      addToast(tagLabel(tag), 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to tag version';
      setVersionErrors((prev) => ({ ...prev, [versionId]: msg }));
    } finally {
      setBusyVersions((prev) => { const next = { ...prev }; delete next[versionId]; return next; });
    }
  };

  const handleRollback = async (versionId: string) => {
    setBusyVersions((prev) => ({ ...prev, [versionId]: 'rollback' }));
    setVersionErrors((prev) => { const next = { ...prev }; delete next[versionId]; return next; });
    try {
      await rollbackPromptVersion(versionId);
      await fetchVersions(true);
      await fetchPersonas();
      addToast('Rolled back successfully', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to rollback version';
      setVersionErrors((prev) => ({ ...prev, [versionId]: msg }));
    } finally {
      setBusyVersions((prev) => { const next = { ...prev }; delete next[versionId]; return next; });
    }
  };

  if (!personaId) {
    return <div className="text-sm text-muted-foreground/60 text-center py-8">No persona selected</div>;
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* Left: Version list */}
      <div className="w-72 flex-shrink-0 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-2 flex-shrink-0">
          <GitBranch className="w-4 h-4 text-primary/70" />
          <h3 className="text-sm font-medium text-foreground/80">Prompt Versions</h3>
          <span className="ml-auto text-xs text-muted-foreground/60">{filteredCount}/{versions.length}</span>
        </div>

        {/* Filter pill tabs */}
        <div className="flex items-center gap-1 mb-2 flex-shrink-0 flex-wrap">
          {([
            { id: 'all' as const, label: 'All' },
            { id: 'production' as const, label: 'Production' },
            { id: 'experimental' as const, label: 'Experimental' },
            { id: 'archived' as const, label: 'Archived' },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTagFilter(tab.id)}
              data-testid={`version-filter-${tab.id}`}
              className={`px-2 py-0.5 text-xs rounded-full transition-colors border ${
                tagFilter === tab.id
                  ? 'bg-primary/15 text-foreground/80 border-primary/25'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/40 border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            onClick={() => setSortOrder((o) => o === 'newest' ? 'oldest' : 'newest')}
            data-testid="version-sort-toggle"
            className="ml-auto flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground/60 hover:text-muted-foreground rounded transition-colors"
            title={`Sort: ${sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}`}
          >
            <ArrowUpDown className="w-3 h-3" />
            {sortOrder === 'newest' ? 'New' : 'Old'}
          </button>
        </div>

        {error && (
          <div
            data-testid="prompt-lab-error"
            className="mb-2 px-3 py-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between"
          >
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              data-testid="prompt-lab-error-dismiss-btn"
              className="ml-2 text-red-400 hover:text-red-300"
            >
              &times;
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 text-muted-foreground/60 animate-spin" />
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <GitBranch className="w-8 h-8 text-muted-foreground/20 mx-auto" />
            <p className="text-sm text-muted-foreground/60">No versions yet</p>
            <p className="text-xs text-muted-foreground/40">Versions are created automatically when you edit the prompt</p>
          </div>
        ) : filteredCount === 0 ? (
          <div className="text-center py-8 space-y-2">
            <p className="text-sm text-muted-foreground/60">No {tagFilter} versions</p>
            <button
              onClick={() => setTagFilter('all')}
              className="text-xs text-primary/70 hover:text-primary transition-colors"
            >
              Show all versions
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-1">
            {grouped.map((g) => (
              <div key={g.group} className="mb-1">
                {/* Sticky date group header */}
                <button
                  onClick={() => toggleGroupCollapse(g.group)}
                  data-testid={`version-group-${g.group.toLowerCase().replace(/\s/g, '-')}`}
                  className="sticky top-0 z-10 w-full flex items-center gap-1.5 py-1.5 px-1 text-xs font-mono uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground/70 bg-background/80 backdrop-blur-sm transition-colors"
                >
                  {collapsedGroups.has(g.group)
                    ? <ChevronRight className="w-3 h-3" />
                    : <ChevronDown className="w-3 h-3" />
                  }
                  {g.group}
                  <span className="text-muted-foreground/30 ml-auto">{g.versions.length}</span>
                </button>
                {!collapsedGroups.has(g.group) && (
                  <div className="space-y-1.5">
                    {g.versions.map((v) => (
                      <VersionItem
                        key={v.id}
                        version={v}
                        isSelected={selectedId === v.id}
                        isCompareA={compareAId === v.id}
                        isCompareB={compareBId === v.id}
                        onSelect={() => setSelectedId(selectedId === v.id ? null : v.id)}
                        onTag={(tag) => void handleTag(v.id, tag)}
                        onRollback={() => void handleRollback(v.id)}
                        onSetCompareA={() => setCompareAId(compareAId === v.id ? null : v.id)}
                        onSetCompareB={() => setCompareBId(compareBId === v.id ? null : v.id)}
                        activeAction={busyVersions[v.id] ?? null}
                        actionError={versionErrors[v.id] ?? null}
                        onDismissError={() => setVersionErrors((prev) => { const next = { ...prev }; delete next[v.id]; return next; })}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: Detail panel */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Panel tabs */}
        <div className="flex items-center gap-1 mb-3 flex-shrink-0">
          {[
            { id: 'diff' as const, label: 'Compare', icon: ArrowLeftRight },
            { id: 'ab-test' as const, label: 'A/B Test', icon: FlaskConical },
            { id: 'rollback' as const, label: 'Health', icon: Shield },
            { id: 'performance' as const, label: 'Performance', icon: TrendingUp },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActivePanel(tab.id)}
              data-testid={`prompt-lab-tab-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activePanel === tab.id
                  ? 'bg-primary/10 text-foreground/80 border border-primary/20'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto">
          {activePanel === 'diff' && (
            compareA && compareB ? (
              <DiffViewer versionA={compareA} versionB={compareB} />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 space-y-3">
                <div className="w-12 h-12 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center">
                  <ArrowLeftRight className="w-6 h-6 text-primary/30" />
                </div>
                <h4 className="text-sm font-medium text-foreground/70">Compare prompt versions</h4>
                <p className="text-xs text-muted-foreground/50 text-center max-w-xs">
                  See exactly what changed between two versions side-by-side. Pick any two from the list, or let us auto-select.
                </p>
                {versions.length >= 2 ? (
                  <button
                    onClick={() => {
                      setCompareAId(versions[0]!.id);
                      setCompareBId(versions[1]!.id);
                    }}
                    className="mt-1 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    Start comparing
                  </button>
                ) : (
                  <p className="text-xs text-muted-foreground/40">
                    Create at least two versions to compare them
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/40">
                  <span>or click</span>
                  <span className="font-mono bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">A</span>
                  <span>&</span>
                  <span className="font-mono bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded">B</span>
                  <span>on any version</span>
                </div>
              </div>
            )
          )}

          {activePanel === 'ab-test' && (
            <AbTestPanel personaId={personaId} compareA={compareA} compareB={compareB} />
          )}

          {activePanel === 'rollback' && (
            <AutoRollbackSettings personaId={personaId} />
          )}

          {activePanel === 'performance' && (
            <PromptPerformanceDashboard personaId={personaId} />
          )}
        </div>
      </div>
    </div>
  );
}
