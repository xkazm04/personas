import { useEffect, useState, lazy, Suspense, useMemo } from 'react';
import { Target, Trash2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { SectionHeader } from '../_shared/SectionHeader';
import { EmptyState, NoActiveProject } from '../_shared/EmptyState';
import type { ResearchFinding } from '@/api/researchLab/researchLab';

const AddFindingForm = lazy(() => import('./AddFindingForm'));

export default function FindingsPanel() {
  const { t } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeResearchProjectId);
  const findings = useSystemStore((s) => s.researchFindings);
  const loading = useSystemStore((s) => s.researchFindingsLoading);
  const fetchFindings = useSystemStore((s) => s.fetchResearchFindings);
  const deleteFinding = useSystemStore((s) => s.deleteResearchFinding);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);

  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (activeProjectId) fetchFindings(activeProjectId);
  }, [activeProjectId, fetchFindings]);

  const projectFindings = useMemo(
    () => findings.filter((f) => f.projectId === activeProjectId),
    [findings, activeProjectId],
  );

  if (!activeProjectId) {
    return (
      <NoActiveProject
        icon={Target}
        message={t.research_lab.select_project_first}
        onGoToProjects={() => setResearchLabTab('projects')}
        goToProjectsLabel={t.research_lab.projects}
      />
    );
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try { await deleteFinding(id); } catch (err) { toastCatch("FindingsPanel:delete")(err); }
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto">
      <SectionHeader
        title={t.research_lab.findings}
        actionLabel={t.research_lab.create_finding}
        onAction={() => setShowForm(true)}
        extra={<span className="typo-caption text-foreground/40">{projectFindings.length}</span>}
      />

      {loading && projectFindings.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="typo-body text-foreground/50">{t.common.loading}</p>
        </div>
      ) : projectFindings.length === 0 ? (
        <EmptyState
          icon={Target}
          title={t.research_lab.no_findings}
          hint={t.research_lab.no_findings_hint}
          actionLabel={t.research_lab.create_finding}
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="space-y-3">
          {projectFindings.map((f: ResearchFinding) => (
            <div
              key={f.id}
              className="rounded-card bg-secondary/50 border border-border/30 p-4 hover:border-primary/30 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <Target className="w-4 h-4 text-cyan-400/80 mt-1 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <h3 className="typo-body text-foreground font-semibold">{f.title}</h3>
                  {f.description && (
                    <p className="typo-caption text-foreground/60 mt-1.5 line-clamp-3">{f.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {f.category && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/15 text-cyan-300">{f.category}</span>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary/60">
                      {f.status.replace(/_/g, ' ')}
                    </span>
                    <span className="typo-micro text-foreground/40">
                      {t.research_lab.confidence} {Math.round(f.confidence * 100)}%
                    </span>
                    {f.generatedBy && (
                      <span className="typo-micro text-foreground/30">· {f.generatedBy}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(e, f.id)}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-red-400/60 hover:text-red-400 transition-all flex-shrink-0"
                  title={t.common.delete}
                  aria-label={t.common.delete}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Suspense fallback={null}>
          <AddFindingForm projectId={activeProjectId} onClose={() => setShowForm(false)} />
        </Suspense>
      )}
    </div>
  );
}
