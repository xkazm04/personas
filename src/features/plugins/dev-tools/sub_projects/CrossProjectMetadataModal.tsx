import { useState, useEffect, useCallback, useMemo } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { StatCard } from '../sub_overview/OverviewParts';
import {
  X, RefreshCw, Network, Layers, Tag, Database, Globe,
  FolderTree, Target, Link2, Sparkles, Clock, AlertCircle,
  CheckCircle2, Zap,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
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
  'frontend': 'bg-surface-1 text-status-info border-hair',
  'rust-backend': 'bg-surface-1 text-status-warning border-hair',
  'node-backend': 'bg-surface-1 text-status-success border-hair',
  'python-backend': 'bg-surface-1 text-status-warning border-hair',
  'database': 'bg-surface-1 text-role-agent border-hair',
  'typescript': 'bg-surface-1 text-status-info border-hair',
  'devops': 'bg-surface-1 text-role-highlight border-hair',
};

function techColor(layer: string): string {
  return TECH_COLORS[layer] ?? 'bg-surface-1 text-primary border-hair';
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function ProjectCard({ project }: { project: CrossProjectProjectMetadata }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const hasContexts = project.context_count > 0;

  return (
    <div className={`rounded-modal border p-4 transition-colors ${
      hasContexts
        ? 'border-hair bg-surface-1 hover:bg-primary/8'
        : 'border-hair bg-surface-2'
    }`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-modal bg-surface-2 border border-hair flex items-center justify-center flex-shrink-0">
          <FolderTree className="w-5 h-5 text-ink-2" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="typo-body text-primary">{project.name}</h3>
            <span className={`rounded-interactive px-2 py-0.5 typo-body border ${
              project.status === 'active'
                ? 'bg-surface-1 text-status-success border-hair'
                : 'bg-muted/20 text-foreground border-muted/30'
            }`}>
              {project.status}
            </span>
            {project.active_goal_count > 0 && (
              <span className="rounded-interactive px-2 py-0.5 typo-body bg-surface-1 text-role-agent border border-hair flex items-center gap-1">
                <Target className="w-3 h-3" /> {project.active_goal_count} {t.plugins.dev_projects.active_goals}
              </span>
            )}
          </div>
          <p className="typo-body text-foreground mt-0.5 truncate">{project.root_path}</p>
        </div>
        {hasContexts && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="typo-body text-primary/70 hover:text-primary px-2 py-1 rounded-card hover:bg-primary/10 flex-shrink-0"
          >
            {expanded ? t.plugins.dev_tools.collapse : t.plugins.dev_tools.details}
          </button>
        )}
      </div>

      {/* Summary */}
      <p className="typo-body text-foreground mb-3">{project.summary}</p>

      {!hasContexts && (
        <div className="flex items-center gap-2 typo-body text-status-warning bg-status-warning/10 px-3 py-2 rounded-card">
          <AlertCircle className="w-4 h-4" />
          {t.plugins.dev_projects.run_context_map_scan}
        </div>
      )}

      {hasContexts && (
        <>
          {/* Tech layers */}
          {project.tech_layers.length > 0 && (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Layers className="w-3.5 h-3.5 text-foreground" />
              {project.tech_layers.map((layer) => (
                <span key={layer} className={`rounded-interactive px-2.5 py-0.5 typo-body border ${techColor(layer)}`}>
                  {layer}
                </span>
              ))}
            </div>
          )}

          {/* Capabilities */}
          {project.capabilities.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center gap-1.5 typo-body text-foreground mb-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                {t.plugins.dev_tools.capabilities}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {project.capabilities.map((cap) => (
                  <span
                    key={cap.name}
                    className="rounded-card px-2.5 py-1 typo-body bg-surface-1 border border-hair text-foreground"
                  >
                    {cap.name} <span className="text-foreground">· {cap.context_count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="rounded-card bg-background/40 border border-hair px-2.5 py-1.5 text-center">
              <div className="typo-body text-foreground">{project.context_count}</div>
              <div className="typo-body text-foreground">contexts</div>
            </div>
            <div className="rounded-card bg-background/40 border border-hair px-2.5 py-1.5 text-center">
              <div className="typo-body text-foreground">{project.keywords.length}</div>
              <div className="typo-body text-foreground">keywords</div>
            </div>
            <div className="rounded-card bg-background/40 border border-hair px-2.5 py-1.5 text-center">
              <div className="typo-body text-foreground">{project.entry_points.length}</div>
              <div className="typo-body text-foreground">{t.plugins.dev_projects.entry_points}</div>
            </div>
            <div className="rounded-card bg-background/40 border border-hair px-2.5 py-1.5 text-center">
              <div className="typo-body text-foreground">{project.db_tables.length}</div>
              <div className="typo-body text-foreground">{t.plugins.dev_projects.db_tables}</div>
            </div>
          </div>

          {/* Expanded details */}
          {expanded && (
            <div className="space-y-3 pt-3 border-t border-hair">
              {project.keywords.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 typo-body text-foreground mb-1.5">
                    <Tag className="w-3.5 h-3.5" />
                    {t.plugins.dev_projects.top_keywords}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {project.keywords.map((kw) => (
                      <span key={kw} className="rounded px-1.5 py-0.5 typo-body bg-background/60 text-foreground border border-hair">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {project.entry_points.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 typo-body text-foreground mb-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    {t.plugins.dev_projects.entry_points_header}
                  </div>
                  <div className="space-y-0.5">
                    {project.entry_points.slice(0, 8).map((ep) => (
                      <div key={ep} className="typo-body text-foreground truncate">{ep}</div>
                    ))}
                  </div>
                </div>
              )}
              {project.db_tables.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 typo-body text-foreground mb-1.5">
                    <Database className="w-3.5 h-3.5" />
                    {t.plugins.dev_projects.db_tables_header}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {project.db_tables.map((tbl) => (
                      <StatusBadge key={tbl} accent="violet" className="typo-body">
                        {tbl}
                      </StatusBadge>
                    ))}
                  </div>
                </div>
              )}
              {project.api_surface.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 typo-body text-foreground mb-1.5">
                    <Globe className="w-3.5 h-3.5" />
                    {t.plugins.dev_projects.api_surface}
                  </div>
                  <div className="space-y-0.5">
                    {project.api_surface.slice(0, 8).map((api) => (
                      <div key={api} className="typo-body text-foreground truncate">{api}</div>
                    ))}
                  </div>
                </div>
              )}
              {project.hot_directories.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 typo-body text-foreground mb-1.5">
                    <FolderTree className="w-3.5 h-3.5" />
                    {t.plugins.dev_projects.hot_directories}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {project.hot_directories.map((d) => (
                      <span key={d} className="rounded px-1.5 py-0.5 typo-body bg-background/60 text-foreground border border-hair">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {project.description && (
                <div>
                  <div className="typo-body text-foreground mb-1.5">{t.plugins.dev_tools.purpose}</div>
                  <p className="typo-body text-foreground">{project.description}</p>
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
      // An IPC rejection is an AppError object, never an Error: the old ladder
      // always fell to a hardcoded English 'Generation failed' and dropped the reason.
      toastCatch('CrossProjectMetadataModal:generate')(err);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 surface-blur-modal p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] rounded-card bg-background border border-hair shadow-elevation-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-hair bg-surface-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-modal bg-surface-1 border border-hair flex items-center justify-center">
              <Network className="w-5 h-5 text-role-agent" />
            </div>
            <div>
              <h2 className="typo-body text-primary">{t.plugins.dev_projects.cross_project_map_title}</h2>
              <p className="typo-body text-foreground">
                {t.plugins.dev_projects.cross_project_map_subtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />}
              onClick={handleGenerate}
              loading={generating}
            >
              {map ? t.plugins.dev_tools.regenerate : t.plugins.dev_tools.generate}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-card hover:bg-primary/10 flex items-center justify-center text-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> {t.plugins.dev_projects.loading_metadata}
            </div>
          ) : !map ? (
            <div className="text-center py-20 space-y-3">
              <div className="w-16 h-16 rounded-card bg-surface-1 border border-hair flex items-center justify-center mx-auto">
                <Network className="w-8 h-8 text-role-agent" />
              </div>
              <p className="typo-body text-foreground">{t.plugins.dev_projects.no_metadata_yet}</p>
              <p className="typo-body text-foreground max-w-md mx-auto">
                Click <strong>Generate</strong> {t.plugins.dev_projects.generate_metadata_prompt}
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
              <div className="flex items-center gap-2 typo-body text-foreground">
                <Clock className="w-3.5 h-3.5" />
                Generated {<AbsoluteTime timestamp={map.generated_at} />}
              </div>

              {/* Tech distribution */}
              {map.cross_project.tech_distribution.length > 0 && (
                <div className="rounded-modal border border-hair p-4">
                  <h3 className="typo-body text-primary mb-2 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-status-info" />
                    {t.plugins.dev_projects.tech_distribution}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    {map.cross_project.tech_distribution.map((td) => (
                      <span key={td.layer} className={`rounded-interactive px-3 py-1 typo-body border ${techColor(td.layer)}`}>
                        {td.layer} <span className="opacity-60">· {td.project_count} project{td.project_count !== 1 ? 's' : ''}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Shared keywords */}
              {map.cross_project.shared_keywords.length > 0 && (
                <div className="rounded-modal border border-hair p-4">
                  <h3 className="typo-body text-primary mb-2 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-role-agent" />
                    {t.plugins.dev_projects.shared_keywords}({map.cross_project.shared_keywords.length})
                  </h3>
                  <p className="typo-body text-foreground mb-2">
                    {t.plugins.dev_projects.shared_keywords_subtitle}
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {map.cross_project.shared_keywords.slice(0, 30).map((sk) => (
                      <StatusBadge
                        key={sk.keyword}
                        accent="violet"
                        className="rounded-card typo-body"
                        title={`In: ${sk.projects.join(', ')}`}
                      >
                        {sk.keyword} <span className="opacity-60">× {sk.count}</span>
                      </StatusBadge>
                    ))}
                  </div>
                </div>
              )}

              {/* Similarity matrix */}
              {map.cross_project.similarity_matrix.length > 0 && (
                <div className="rounded-modal border border-hair p-4">
                  <h3 className="typo-body text-primary mb-2 flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-role-highlight" />
                    {t.plugins.dev_projects.project_similarity}
                  </h3>
                  <div className="space-y-1.5">
                    {map.cross_project.similarity_matrix
                      .sort((a, b) => b.similarity - a.similarity)
                      .slice(0, 10)
                      .map((sim, i) => (
                        <div key={i} className="flex items-center gap-3 typo-body">
                          <span className="text-foreground flex-1 min-w-0 truncate">{sim.source}</span>
                          <span className="text-foreground">↔</span>
                          <span className="text-foreground flex-1 min-w-0 truncate">{sim.target}</span>
                          <div className="w-24 h-1.5 bg-surface-1 rounded-full overflow-hidden flex-shrink-0">
                            <div
                              className="bg-primary h-full"
                              style={{ width: `${Math.max(5, sim.similarity * 100)}%` }}
                            />
                          </div>
                          <span className="typo-body text-role-highlight w-12 text-right">
                            {Math.round(sim.similarity * 100)}%
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Projects */}
              <div className="space-y-3">
                <h3 className="typo-body text-primary flex items-center gap-2">
                  <FolderTree className="w-4 h-4 text-ink-2" />
                  {t.plugins.dev_projects.projects_header}({map.projects.length})
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

