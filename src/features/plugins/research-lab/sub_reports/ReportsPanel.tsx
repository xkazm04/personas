import { useEffect, useState, lazy, Suspense, useMemo } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { SectionHeader } from '../_shared/SectionHeader';
import { EmptyState, NoActiveProject } from '../_shared/EmptyState';
import type { ResearchReport } from '@/api/researchLab/researchLab';
import type { Translations } from '@/i18n/en';

const AddReportForm = lazy(() => import('./AddReportForm'));

function reportTypeLabel(t: Translations, type: string | null): string {
  if (!type) return '';
  const map: Record<string, string> = {
    literature_review: t.research_lab.literature_review,
    experiment_report: t.research_lab.experiment_report,
    full_paper: t.research_lab.full_paper,
    executive_summary: t.research_lab.executive_summary,
  };
  return map[type] ?? type.replace(/_/g, ' ');
}

export default function ReportsPanel() {
  const { t } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeResearchProjectId);
  const reports = useSystemStore((s) => s.researchReports);
  const loading = useSystemStore((s) => s.researchReportsLoading);
  const fetchReports = useSystemStore((s) => s.fetchResearchReports);
  const deleteReport = useSystemStore((s) => s.deleteResearchReport);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);

  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (activeProjectId) fetchReports(activeProjectId);
  }, [activeProjectId, fetchReports]);

  const projectReports = useMemo(
    () => reports.filter((r) => r.projectId === activeProjectId),
    [reports, activeProjectId],
  );

  if (!activeProjectId) {
    return (
      <NoActiveProject
        icon={FileText}
        message={t.research_lab.select_project_first}
        onGoToProjects={() => setResearchLabTab('projects')}
        goToProjectsLabel={t.research_lab.projects}
      />
    );
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try { await deleteReport(id); } catch (err) { toastCatch("ReportsPanel:delete")(err); }
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto">
      <SectionHeader
        title={t.research_lab.reports}
        actionLabel={t.research_lab.create_report}
        onAction={() => setShowForm(true)}
        extra={<span className="typo-caption text-foreground/40">{projectReports.length}</span>}
      />

      {loading && projectReports.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="typo-body text-foreground/50">{t.common.loading}</p>
        </div>
      ) : projectReports.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t.research_lab.no_reports}
          hint={t.research_lab.no_reports_hint}
          actionLabel={t.research_lab.create_report}
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projectReports.map((r: ResearchReport) => (
            <div
              key={r.id}
              className="rounded-card bg-secondary/50 border border-border/30 p-4 hover:border-primary/30 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <FileText className="w-4 h-4 text-pink-400/80 mt-1 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <h3 className="typo-body text-foreground font-semibold truncate">{r.title}</h3>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {r.reportType && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-pink-500/15 text-pink-300">
                        {reportTypeLabel(t, r.reportType)}
                      </span>
                    )}
                    {r.format && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-foreground/10 text-foreground/50 uppercase">
                        {r.format}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary/60">
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(e, r.id)}
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
          <AddReportForm projectId={activeProjectId} onClose={() => setShowForm(false)} />
        </Suspense>
      )}
    </div>
  );
}
