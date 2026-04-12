import { useEffect, useState, lazy, Suspense } from 'react';
import { FolderSearch, Plus, Trash2, ChevronRight, BookMarked, CalendarDays } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';

const ResearchProjectForm = lazy(() => import('./ResearchProjectForm'));

const STATUS_COLORS: Record<string, string> = {
  scoping: 'bg-amber-500/20 text-amber-300',
  literature_review: 'bg-blue-500/20 text-blue-300',
  hypothesis: 'bg-violet-500/20 text-violet-300',
  experiment: 'bg-emerald-500/20 text-emerald-300',
  analysis: 'bg-cyan-500/20 text-cyan-300',
  writing: 'bg-pink-500/20 text-pink-300',
  review: 'bg-orange-500/20 text-orange-300',
  complete: 'bg-green-500/20 text-green-300',
};

export default function ResearchProjectList() {
  const { t } = useTranslation();
  const projects = useSystemStore((s) => s.researchProjects);
  const loading = useSystemStore((s) => s.researchProjectsLoading);
  const fetchProjects = useSystemStore((s) => s.fetchResearchProjects);
  const deleteProject = useSystemStore((s) => s.deleteResearchProject);
  const activeId = useSystemStore((s) => s.activeResearchProjectId);
  const setActiveProject = useSystemStore((s) => s.setActiveResearchProject);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);

  const syncToObsidian = useSystemStore((s) => s.syncToObsidian);
  const syncDailyNote = useSystemStore((s) => s.syncDailyNote);
  const addToast = useToastStore((s) => s.addToast);

  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const handleSync = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setSyncing(projectId);
    try {
      const count = await syncToObsidian(projectId);
      addToast(`${t.research_lab.sync_complete} (${count} experiments)`, 'success');
    } catch (err) { toastCatch("ResearchProjectList:sync")(err); }
    finally { setSyncing(null); }
  };

  const handleDailySync = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setSyncing(projectId);
    try {
      const msg = await syncDailyNote(projectId);
      addToast(msg, 'success');
    } catch (err) { toastCatch("ResearchProjectList:dailySync")(err); }
    finally { setSyncing(null); }
  };

  const handleSelect = (id: string) => {
    setActiveProject(id);
    setResearchLabTab('literature');
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteProject(id);
    } catch (err) {
      toastCatch("ResearchProjectList:delete")(err);
    }
  };

  if (loading && projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="typo-body text-foreground/50">{t.common.loading}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="typo-heading text-foreground">{t.research_lab.projects}</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.research_lab.create_project}
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <FolderSearch className="w-12 h-12 text-foreground/20" />
          <p className="typo-body text-foreground/50">{t.research_lab.no_projects}</p>
          <p className="typo-caption text-foreground/30 max-w-sm text-center">{t.research_lab.no_projects_hint}</p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg typo-body bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t.research_lab.create_project}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => handleSelect(project.id)}
              className={`rounded-card border p-4 hover:border-primary/30 transition-colors cursor-pointer group ${
                activeId === project.id
                  ? 'bg-primary/5 border-primary/20'
                  : 'bg-secondary/50 border-border/30'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="typo-body text-foreground font-semibold truncate">{project.name}</h3>
                    <ChevronRight className="w-3.5 h-3.5 text-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </div>
                  {project.description && (
                    <p className="typo-caption text-foreground/60 mt-1 line-clamp-2">{project.description}</p>
                  )}
                  {project.thesis && (
                    <p className="typo-micro text-foreground/40 mt-2 italic line-clamp-2">{project.thesis}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[project.status] ?? 'bg-foreground/10 text-foreground/50'}`}>
                    {project.status.replace(/_/g, ' ')}
                  </span>
                  <button
                    onClick={(e) => handleDelete(e, project.id)}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-red-400/60 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {project.domain && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary/60">{project.domain}</span>
                )}
                {project.obsidianVaultPath && (
                  <>
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-violet-500/20 text-violet-300">{t.research_lab.vault_connected}</span>
                    <button
                      onClick={(e) => handleSync(e, project.id)}
                      disabled={syncing === project.id}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      title={t.research_lab.sync_to_obsidian}
                    >
                      <BookMarked className="w-3 h-3" />
                      {syncing === project.id ? t.research_lab.syncing : t.research_lab.sync_to_obsidian}
                    </button>
                    <button
                      onClick={(e) => handleDailySync(e, project.id)}
                      disabled={syncing === project.id}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                      title={t.research_lab.daily_note_sync}
                    >
                      <CalendarDays className="w-3 h-3" />
                      {t.research_lab.daily_note_sync}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Suspense fallback={null}>
          <ResearchProjectForm onClose={() => setShowForm(false)} />
        </Suspense>
      )}
    </div>
  );
}
