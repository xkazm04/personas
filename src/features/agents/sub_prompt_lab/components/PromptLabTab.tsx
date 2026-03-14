import {
  GitBranch, FlaskConical,
  Shield, ArrowLeftRight, TrendingUp,
  ArrowUpDown, ChevronDown, ChevronRight,
} from 'lucide-react';
import { VersionItem, DiffViewer } from '@/features/agents/sub_lab/shared';
import { AutoRollbackSettings } from './AutoRollbackSettings';
import { PromptPerformanceDashboard } from './performance/PromptPerformanceDashboard';
import { usePromptVersions } from '../libs/usePromptVersions';
import { useState } from 'react';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import { Button } from '@/features/shared/components/buttons';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';

export function PromptLabTab() {
  const pv = usePromptVersions();
  const [activePanel, setActivePanel] = useState<'diff' | 'rollback' | 'performance'>('diff');
  const setLabMode = useAgentStore((s) => s.setLabMode);
  const setAbPreselect = useAgentStore((s) => s.setAbPreselect);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);

  const handleOpenLabAb = () => {
    setAbPreselect(pv.compareAId, pv.compareBId);
    setEditorTab('lab');
    setLabMode('ab');
  };

  if (!pv.personaId) {
    return <div className="text-sm text-muted-foreground/60 text-center py-8">No persona selected</div>;
  }

  return (
    <div className={`flex ${IS_MOBILE ? 'flex-col' : ''} h-full min-h-0 gap-4`}>
      {/* Left: Version list */}
      <div className={`${IS_MOBILE ? 'w-full max-h-[40%]' : 'w-72 3xl:w-80 4xl:w-96'} flex-shrink-0 flex flex-col min-h-0`}>
        <div className="flex items-center gap-2 mb-2 flex-shrink-0">
          <GitBranch className="w-4 h-4 text-primary/70" />
          <h3 className="text-sm font-medium text-foreground/80">Prompt Versions</h3>
          <span className="ml-auto text-sm text-muted-foreground/60">{pv.filteredCount}/{pv.versions.length}</span>
        </div>

        {/* Filter pill tabs */}
        <div className="flex items-center gap-1 mb-2 flex-shrink-0 flex-wrap">
          {([
            { id: 'all' as const, label: 'All' },
            { id: 'production' as const, label: 'Production' },
            { id: 'experimental' as const, label: 'Experimental' },
            { id: 'archived' as const, label: 'Archived' },
          ] as const).map((tab) => (
            <Button
              key={tab.id}
              variant={pv.tagFilter === tab.id ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => pv.setTagFilter(tab.id)}
              data-testid={`version-filter-${tab.id}`}
              className={`rounded-full border ${
                pv.tagFilter === tab.id
                  ? 'bg-primary/15 text-foreground/80 border-primary/30'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/40 border-transparent'
              }`}
            >
              {tab.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="xs"
            icon={<ArrowUpDown className="w-3 h-3" />}
            onClick={() => pv.setSortOrder((o) => o === 'newest' ? 'oldest' : 'newest')}
            data-testid="version-sort-toggle"
            title={`Sort: ${pv.sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}`}
            className="ml-auto text-muted-foreground/60 hover:text-muted-foreground"
          >
            {pv.sortOrder === 'newest' ? 'New' : 'Old'}
          </Button>
        </div>

        {pv.error && (
          <div data-testid="prompt-lab-error" className="mb-2 px-3 py-2 text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between">
            <span>{pv.error}</span>
            <Button variant="ghost" size="icon-sm" onClick={() => pv.setError(null)} data-testid="prompt-lab-error-dismiss-btn" className="ml-2 text-red-400 hover:text-red-300">&times;</Button>
          </div>
        )}

        {pv.loading ? (
          <ContentLoader variant="panel" hint="prompt-lab" />
        ) : pv.versions.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <GitBranch className="w-8 h-8 text-muted-foreground/20 mx-auto" />
            <p className="text-sm text-muted-foreground/60">No versions yet</p>
            <p className="text-sm text-muted-foreground/60">Versions are created automatically when you edit the prompt</p>
          </div>
        ) : pv.filteredCount === 0 ? (
          <div className="text-center py-8 space-y-2">
            <p className="text-sm text-muted-foreground/60">No {pv.tagFilter} versions</p>
            <Button variant="link" size="sm" onClick={() => pv.setTagFilter('all')} className="text-primary/70 hover:text-primary">Show all versions</Button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-1 relative">
            <div className="absolute left-3.5 top-2 bottom-2 w-px bg-primary/10" aria-hidden="true" />
            {pv.grouped.map((g) => (
              <div key={g.group} className="mb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={pv.collapsedGroups.has(g.group) ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  onClick={() => pv.toggleGroupCollapse(g.group)}
                  data-testid={`version-group-${g.group.toLowerCase().replace(/\s/g, '-')}`}
                  className="sticky top-0 z-10 w-full justify-start py-1.5 px-1 font-mono uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground/70 bg-background/80 backdrop-blur-sm"
                >
                  {g.group}
                  <span className="text-muted-foreground/60 ml-auto">{g.versions.length}</span>
                </Button>
                {!pv.collapsedGroups.has(g.group) && (
                  <div className="space-y-1.5">
                    {g.versions.map((v) => (
                      <div key={v.id} className="relative pl-7">
                        <span
                          className={`absolute left-[11px] top-5 w-1.5 h-1.5 rounded-full border border-background ${
                            v.tag === 'production' ? 'bg-emerald-400' : v.tag === 'experimental' ? 'bg-amber-400' : 'bg-zinc-400'
                          } ${pv.selectedId === v.id ? 'ring-2 ring-primary/60' : ''}`}
                          aria-hidden="true"
                        />
                        <VersionItem
                          version={v}
                          isSelected={pv.selectedId === v.id}
                          isCompareA={pv.compareAId === v.id}
                          isCompareB={pv.compareBId === v.id}
                          onSelect={() => pv.setSelectedId(pv.selectedId === v.id ? null : v.id)}
                          onTag={(tag) => void pv.handleTag(v.id, tag)}
                          onRollback={() => void pv.handleRollback(v.id)}
                          onSetCompareA={() => pv.setCompareAId(pv.compareAId === v.id ? null : v.id)}
                          onSetCompareB={() => pv.setCompareBId(pv.compareBId === v.id ? null : v.id)}
                          activeAction={pv.busyVersions[v.id] ?? null}
                          actionError={pv.versionErrors[v.id] ?? null}
                          onDismissError={() => pv.dismissVersionError(v.id)}
                        />
                      </div>
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
        <div className="flex items-center gap-1 mb-3 flex-shrink-0">
          {[
            { id: 'diff' as const, label: 'Compare', icon: ArrowLeftRight },
            { id: 'rollback' as const, label: 'Health', icon: Shield },
            { id: 'performance' as const, label: 'Performance', icon: TrendingUp },
          ].map((tab) => (
            <Button
              key={tab.id}
              variant={activePanel === tab.id ? 'secondary' : 'ghost'}
              size="sm"
              icon={<tab.icon className="w-3.5 h-3.5" />}
              onClick={() => setActivePanel(tab.id)}
              data-testid={`prompt-lab-tab-${tab.id}`}
              className={
                activePanel === tab.id
                  ? 'bg-primary/10 text-foreground/80 border border-primary/20'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
              }
            >
              {tab.label}
            </Button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {activePanel === 'diff' && (
            pv.compareA && pv.compareB ? (
              <div className="space-y-3">
                <DiffViewer versionA={pv.compareA} versionB={pv.compareB} />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FlaskConical className="w-3.5 h-3.5" />}
                  onClick={handleOpenLabAb}
                  className="bg-primary/10 text-primary/80 hover:bg-primary/15"
                >
                  Run in Lab A/B Test
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 space-y-3">
                <div className="w-12 h-12 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center">
                  <ArrowLeftRight className="w-6 h-6 text-primary/30" />
                </div>
                <h4 className="text-sm font-medium text-foreground/70">Compare prompt versions</h4>
                <p className="text-sm text-muted-foreground/50 text-center max-w-xs">
                  See exactly what changed between two versions side-by-side. Pick any two from the list, or let us auto-select.
                </p>
                {pv.versions.length >= 2 ? (
                  <Button
                    variant="secondary"
                    size="md"
                    icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
                    onClick={() => { pv.setCompareAId(pv.versions[0]!.id); pv.setCompareBId(pv.versions[1]!.id); }}
                    className="mt-1 bg-primary/15 text-primary hover:bg-primary/25"
                  >
                    Start comparing
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground/60">Create at least two versions to compare them</p>
                )}
                <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground/60">
                  <span>or click</span>
                  <span className="font-mono bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">A</span>
                  <span>&</span>
                  <span className="font-mono bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded">B</span>
                  <span>on any version</span>
                </div>
              </div>
            )
          )}
          {activePanel === 'rollback' && <AutoRollbackSettings personaId={pv.personaId} />}
          {activePanel === 'performance' && <PromptPerformanceDashboard personaId={pv.personaId} />}
        </div>
      </div>
    </div>
  );
}
