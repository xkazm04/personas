import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  X, RefreshCw, Network, Layers, Tag, Database, Globe,
  FolderTree, Target, Link2, Sparkles, Clock, AlertCircle,
  CheckCircle2, Zap,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useToastStore } from '@/stores/toastStore';
import {
  generateCrossProjectMetadata,
  getCrossProjectMetadata,
  type CrossProjectMetadataMap,
  type CrossProjectProjectMetadata,
} from '@/api/devTools/devTools';

interface CrossProjectMetadataModalProps {
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Tech layer color mapping
// ---------------------------------------------------------------------------

const TECH_COLORS: Record<string, string> = {
  'frontend': 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  'rust-backend': 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  'node-backend': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  'python-backend': 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  'database': 'bg-violet-500/15 text-violet-400 border-violet-500/25',
  'typescript': 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  'devops': 'bg-pink-500/15 text-pink-400 border-pink-500/25',
};

function techColor(layer: string): string {
  return TECH_COLORS[layer] ?? 'bg-primary/10 text-primary border-primary/20';
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function ProjectCard({ project }: { project: CrossProjectProjectMetadata }) {
  const [expanded, setExpanded] = useState(false);
  const hasContexts = project.context_count > 0;

  return (
    <div className={`rounded-xl border p-4 transition-colors ${
      hasContexts
        ? 'border-primary/15 bg-primary/5 hover:bg-primary/8'
        : 'border-amber-500/20 bg-amber-500/5'
    }`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center flex-shrink-0">
          <FolderTree className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-md font-semibold text-foreground/90">{project.name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-md font-medium border ${
              project.status === 'active'
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                : 'bg-muted/20 text-muted-foreground border-muted/30'
            }`}>
              {project.status}
            </span>
            {project.active_goal_count > 0 && (
              <span className="rounded-full px-2 py-0.5 text-md font-medium bg-violet-500/15 text-violet-400 border border-violet-500/25 flex items-center gap-1">
                <Target className="w-3 h-3" /> {project.active_goal_count} active goals
              </span>
            )}
          </div>
          <p className="text-md text-muted-foreground/50 mt-0.5 font-mono truncate">{project.root_path}</p>
        </div>
        {hasContexts && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-md text-primary/70 hover:text-primary px-2 py-1 rounded-lg hover:bg-primary/10 flex-shrink-0"
          >
            {expanded ? 'Collapse' : 'Details'}
          </button>
        )}
      </div>

      {/* Summary */}
      <p className="text-md text-foreground/70 leading-relaxed mb-3">{project.summary}</p>

      {!hasContexts && (
        <div className="flex items-center gap-2 text-md text-amber-400 bg-amber-500/10 px-3 py-2 rounded-lg">
          <AlertCircle className="w-4 h-4" />
          Run Context Map scan for this project to enable rich metadata extraction.
        </div>
      )}

      {hasContexts && (
        <>
          {/* Tech layers */}
          {project.tech_layers.length > 0 && (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Layers className="w-3.5 h-3.5 text-muted-foreground/50" />
              {project.tech_layers.map((layer) => (
                <span key={layer} className={`rounded-full px-2.5 py-0.5 text-md font-medium border ${techColor(layer)}`}>
                  {layer}
                </span>
              ))}
            </div>
          )}

          {/* Capabilities */}
          {project.capabilities.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center gap-1.5 text-md text-muted-foreground/50 mb-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Capabilities
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {project.capabilities.map((cap) => (
                  <span
                    key={cap.name}
                    className="rounded-lg px-2.5 py-1 text-md font-medium bg-primary/10 border border-primary/15 text-foreground/80"
                  >
                    {cap.name} <span className="text-muted-foreground/50">· {cap.context_count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="rounded-lg bg-background/40 border border-primary/10 px-2.5 py-1.5 text-center">
              <div className="text-md font-semibold text-foreground/80">{project.context_count}</div>
              <div className="text-md text-muted-foreground/50">contexts</div>
            </div>
            <div className="rounded-lg bg-background/40 border border-primary/10 px-2.5 py-1.5 text-center">
              <div className="text-md font-semibold text-foreground/80">{project.keywords.length}</div>
              <div className="text-md text-muted-foreground/50">keywords</div>
            </div>
            <div className="rounded-lg bg-background/40 border border-primary/10 px-2.5 py-1.5 text-center">
              <div className="text-md font-semibold text-foreground/80">{project.entry_points.length}</div>
              <div className="text-md text-muted-foreground/50">entry points</div>
            </div>
            <div className="rounded-lg bg-background/40 border border-primary/10 px-2.5 py-1.5 text-center">
              <div className="text-md font-semibold text-foreground/80">{project.db_tables.length}</div>
              <div className="text-md text-muted-foreground/50">db tables</div>
            </div>
          </div>

          {/* Expanded details */}
          {expanded && (
            <div className="space-y-3 pt-3 border-t border-primary/10">
              {project.keywords.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-md text-muted-foreground/50 mb-1.5">
                    <Tag className="w-3.5 h-3.5" />
                    Top Keywords
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {project.keywords.map((kw) => (
                      <span key={kw} className="rounded px-1.5 py-0.5 text-md bg-background/60 text-foreground/70 border border-primary/10">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {project.entry_points.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-md text-muted-foreground/50 mb-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Entry Points
                  </div>
                  <div className="space-y-0.5">
                    {project.entry_points.slice(0, 8).map((ep) => (
                      <div key={ep} className="text-md font-mono text-foreground/70 truncate">{ep}</div>
                    ))}
                  </div>
                </div>
              )}
              {project.db_tables.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-md text-muted-foreground/50 mb-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Database Tables
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {project.db_tables.map((t) => (
                      <span key={t} className="rounded px-1.5 py-0.5 text-md font-mono bg-violet-500/10 text-violet-400 border border-violet-500/20">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {project.api_surface.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-md text-muted-foreground/50 mb-1.5">
                    <Globe className="w-3.5 h-3.5" />
                    API Surface
                  </div>
                  <div className="space-y-0.5">
                    {project.api_surface.slice(0, 8).map((api) => (
                      <div key={api} className="text-md font-mono text-foreground/70 truncate">{api}</div>
                    ))}
                  </div>
                </div>
              )}
              {project.hot_directories.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-md text-muted-foreground/50 mb-1.5">
                    <FolderTree className="w-3.5 h-3.5" />
                    Hot Directories
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {project.hot_directories.map((d) => (
                      <span key={d} className="rounded px-1.5 py-0.5 text-md font-mono bg-background/60 text-foreground/70 border border-primary/10">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {project.description && (
                <div>
                  <div className="text-md text-muted-foreground/50 mb-1.5">Purpose</div>
                  <p className="text-md text-foreground/70 leading-relaxed">{project.description}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function CrossProjectMetadataModal({ open, onClose }: CrossProjectMetadataModalProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [map, setMap] = useState<CrossProjectMetadataMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadCached = useCallback(async () => {
    setLoading(true);
    try {
      const cached = await getCrossProjectMetadata();
      setMap(cached);
    } catch {
      setMap(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadCached();
  }, [open, loadCached]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await generateCrossProjectMetadata();
      setMap(result);
      addToast(`Map generated: ${result.total_projects} projects analyzed`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  }, [addToast]);

  const stats = useMemo(() => {
    if (!map) return null;
    const withContexts = map.projects.filter((p) => p.context_count > 0).length;
    const totalKeywords = new Set(map.projects.flatMap((p) => p.keywords)).size;
    return {
      projects: map.total_projects,
      withContexts,
      uniqueKeywords: totalKeywords,
      sharedKeywords: map.cross_project.shared_keywords.length,
      relations: map.cross_project.relations.length,
    };
  }, [map]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] rounded-2xl bg-background border border-primary/15 shadow-elevation-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Network className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-md font-semibold text-foreground/90">Cross-Project Metadata Map</h2>
              <p className="text-md text-muted-foreground/60">
                Aggregated from existing context maps. Consumed by Codebases connector.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="accent"
              accentColor="violet"
              size="sm"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />}
              onClick={handleGenerate}
              loading={generating}
            >
              {map ? 'Regenerate' : 'Generate'}
            </Button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-primary/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : !map ? (
            <div className="text-center py-20 space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto">
                <Network className="w-8 h-8 text-violet-400/60" />
              </div>
              <p className="text-md text-foreground/80">No metadata map generated yet</p>
              <p className="text-md text-muted-foreground/60 max-w-md mx-auto">
                Click <strong>Generate</strong> to analyze all projects' context maps and build a rich cross-project metadata layer for the Codebases connector.
              </p>
            </div>
          ) : (
            <>
              {/* Stats summary */}
              {stats && (
                <div className="grid grid-cols-5 gap-3">
                  <StatCard label="Projects" value={stats.projects} icon={FolderTree} color="amber" />
                  <StatCard label="With Contexts" value={stats.withContexts} icon={CheckCircle2} color="emerald" />
                  <StatCard label="Unique Keywords" value={stats.uniqueKeywords} icon={Tag} color="blue" />
                  <StatCard label="Shared Keywords" value={stats.sharedKeywords} icon={Sparkles} color="violet" />
                  <StatCard label="Relations" value={stats.relations} icon={Link2} color="pink" />
                </div>
              )}

              {/* Generated timestamp */}
              <div className="flex items-center gap-2 text-md text-muted-foreground/50">
                <Clock className="w-3.5 h-3.5" />
                Generated {new Date(map.generated_at).toLocaleString()}
              </div>

              {/* Tech distribution */}
              {map.cross_project.tech_distribution.length > 0 && (
                <div className="rounded-xl border border-primary/10 p-4">
                  <h3 className="text-md font-semibold text-foreground/80 mb-2 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-400" />
                    Tech Distribution
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    {map.cross_project.tech_distribution.map((t) => (
                      <span key={t.layer} className={`rounded-full px-3 py-1 text-md font-medium border ${techColor(t.layer)}`}>
                        {t.layer} <span className="opacity-60">· {t.project_count} project{t.project_count !== 1 ? 's' : ''}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Shared keywords */}
              {map.cross_project.shared_keywords.length > 0 && (
                <div className="rounded-xl border border-primary/10 p-4">
                  <h3 className="text-md font-semibold text-foreground/80 mb-2 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-400" />
                    Shared Keywords ({map.cross_project.shared_keywords.length})
                  </h3>
                  <p className="text-md text-muted-foreground/50 mb-2">
                    Concepts present in multiple projects — signals where business tasks overlap.
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {map.cross_project.shared_keywords.slice(0, 30).map((sk) => (
                      <span
                        key={sk.keyword}
                        className="rounded-lg px-2.5 py-1 text-md font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20"
                        title={`In: ${sk.projects.join(', ')}`}
                      >
                        {sk.keyword} <span className="opacity-60">× {sk.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Similarity matrix */}
              {map.cross_project.similarity_matrix.length > 0 && (
                <div className="rounded-xl border border-primary/10 p-4">
                  <h3 className="text-md font-semibold text-foreground/80 mb-2 flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-pink-400" />
                    Project Similarity
                  </h3>
                  <div className="space-y-1.5">
                    {map.cross_project.similarity_matrix
                      .sort((a, b) => b.similarity - a.similarity)
                      .slice(0, 10)
                      .map((sim, i) => (
                        <div key={i} className="flex items-center gap-3 text-md">
                          <span className="text-foreground/70 flex-1 min-w-0 truncate">{sim.source}</span>
                          <span className="text-muted-foreground/40">↔</span>
                          <span className="text-foreground/70 flex-1 min-w-0 truncate">{sim.target}</span>
                          <div className="w-24 h-1.5 bg-primary/10 rounded-full overflow-hidden flex-shrink-0">
                            <div
                              className="h-full bg-gradient-to-r from-pink-400 to-violet-400 rounded-full"
                              style={{ width: `${Math.max(5, sim.similarity * 100)}%` }}
                            />
                          </div>
                          <span className="text-md font-medium text-pink-400 w-12 text-right">
                            {Math.round(sim.similarity * 100)}%
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Projects */}
              <div className="space-y-3">
                <h3 className="text-md font-semibold text-foreground/80 flex items-center gap-2">
                  <FolderTree className="w-4 h-4 text-amber-400" />
                  Projects ({map.projects.length})
                </h3>
                {map.projects.map((p) => (
                  <ProjectCard key={p.project_id} project={p} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small stat card
// ---------------------------------------------------------------------------

function StatCard({ label, value, icon: Icon, color }: {
  label: string;
  value: number;
  icon: typeof Tag;
  color: string;
}) {
  return (
    <div className={`rounded-xl border border-${color}-500/20 bg-${color}-500/5 p-3`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 text-${color}-400`} />
        <span className="text-md text-muted-foreground/60">{label}</span>
      </div>
      <div className={`text-md font-bold text-${color}-400`}>{value}</div>
    </div>
  );
}
