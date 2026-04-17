import { useEffect, useMemo } from 'react';
import {
  BookOpen, FolderSearch, Lightbulb, FlaskConical, Target, FileText,
  ArrowRight, Plus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { projectStatusColor, projectStatusLabel } from '../_shared/tokens';
import type { Translations } from '@/i18n/en';

type TabId = 'projects' | 'literature' | 'hypotheses' | 'experiments' | 'findings' | 'reports';

interface StatCard {
  icon: LucideIcon;
  label: string;
  value: number;
  sub?: string;
  tab: TabId;
}

function buildStatCards(
  t: Translations,
  stats: ReturnType<typeof useSystemStore.getState>['researchDashboardStats'],
): StatCard[] {
  return [
    { icon: FolderSearch, label: t.research_lab.projects, value: stats?.totalProjects ?? 0, sub: `${stats?.activeProjects ?? 0} ${t.research_lab.active}`, tab: 'projects' },
    { icon: BookOpen, label: t.research_lab.sources, value: stats?.totalSources ?? 0, tab: 'literature' },
    { icon: Lightbulb, label: t.research_lab.hypotheses, value: stats?.totalHypotheses ?? 0, tab: 'hypotheses' },
    { icon: FlaskConical, label: t.research_lab.experiments, value: stats?.totalExperiments ?? 0, tab: 'experiments' },
    { icon: Target, label: t.research_lab.findings, value: stats?.totalFindings ?? 0, tab: 'findings' },
    { icon: FileText, label: t.research_lab.reports, value: stats?.totalReports ?? 0, tab: 'reports' },
  ];
}

export default function ResearchDashboard() {
  const { t } = useTranslation();
  const stats = useSystemStore((s) => s.researchDashboardStats);
  const fetchStats = useSystemStore((s) => s.fetchResearchDashboardStats);
  const projects = useSystemStore((s) => s.researchProjects);
  const fetchProjects = useSystemStore((s) => s.fetchResearchProjects);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);
  const setActiveProject = useSystemStore((s) => s.setActiveResearchProject);

  useEffect(() => {
    fetchStats();
    fetchProjects();
  }, [fetchStats, fetchProjects]);

  const statCards = useMemo(() => buildStatCards(t, stats), [t, stats]);

  return (
    <div className="p-6 space-y-6 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="typo-section-title">{t.research_lab.dashboard}</h2>
        <button
          onClick={() => setResearchLabTab('projects')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.research_lab.create_project}
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {statCards.map((card) => (
          <button
            key={card.label}
            onClick={() => setResearchLabTab(card.tab)}
            className="rounded-card bg-secondary/50 border border-border/30 p-4 flex items-start gap-3 hover:border-primary/30 transition-colors text-left group"
          >
            <card.icon className="w-5 h-5 text-primary/60 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="typo-data-lg text-primary">{card.value}</p>
              <p className="typo-caption text-foreground">{card.label}</p>
              {card.sub && <p className="typo-caption text-foreground">{card.sub}</p>}
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-foreground mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </button>
        ))}
      </div>

      {/* Recent projects */}
      {projects.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="typo-card-label">{t.research_lab.recent_projects}</h3>
            <button
              onClick={() => setResearchLabTab('projects')}
              className="typo-caption text-primary hover:text-primary transition-colors"
            >
              {t.research_lab.view_all}
            </button>
          </div>

          <div className="space-y-2">
            {projects.slice(0, 5).map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  setActiveProject(project.id);
                  setResearchLabTab('literature');
                }}
                className="w-full rounded-card bg-secondary/30 border border-border/20 p-3 hover:border-primary/20 transition-colors text-left group"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="typo-card-label truncate">{project.name}</p>
                    {project.thesis && (
                      <p className="typo-caption text-foreground truncate mt-0.5">{project.thesis}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${projectStatusColor(project.status)}`}>
                      {projectStatusLabel(t, project.status)}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="rounded-card bg-secondary/30 border border-border/20 p-8 text-center space-y-3">
          <FolderSearch className="w-10 h-10 text-foreground mx-auto" />
          <p className="typo-body-lg text-foreground">{t.research_lab.no_projects}</p>
          <p className="typo-body text-foreground max-w-md mx-auto">{t.research_lab.no_projects_hint}</p>
        </div>
      )}
    </div>
  );
}
