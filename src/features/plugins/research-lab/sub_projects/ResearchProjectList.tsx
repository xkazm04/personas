import { useEffect, useState, lazy, Suspense } from 'react';
import { FolderSearch, Trash2, ChevronRight, BookMarked, CalendarDays, Pencil } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { SectionHeader } from '../_shared/SectionHeader';
import { EmptyState } from '../_shared/EmptyState';
import { projectStatusColor, projectStatusLabel, domainLabel } from '../_shared/tokens';
import type { ResearchProject } from '@/api/researchLab/researchLab';

const ResearchProjectForm = lazy(() => import('./ResearchProjectForm'));

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
  const [editing, setEditing] = useState<ResearchProject | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const handleSync = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setSyncing(projectId);
    try {
      const count = await syncToObsidian(projectId);
      addToast(`${t.research_lab.sync_complete} · ${count} ${t.research_lab.experiments.toLowerCase()}`, 'success');
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

  const handleEdit = (e: React.MouseEvent, project: ResearchProject) => {
    e.stopPropagation();
    setEditing(project);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditing(null);
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
      <SectionHeader
        title={t.research_lab.projects}
        actionLabel={t.research_lab.create_project}
        onAction={() => setShowForm(true)}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderSearch}
          title={t.research_lab.no_projects}
          hint={t.research_lab.no_projects_hint}
          actionLabel={t.research_lab.create_project}
          onAction={() => setShowForm(true)}
        />
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
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${projectStatusColor(project.status)}`}>
                    {projectStatusLabel(t, project.status)}
                  </span>
                  <button
                    onClick={(e) => handleEdit(e, project)}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-secondary/80 text-foreground/50 hover:text-foreground transition-all"
                    title={t.research_lab.edit_project}
                    aria-label={t.research_lab.edit_project}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, project.id)}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-red-400/60 hover:text-red-400 transition-all"
                    title={t.common.delete}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {project.domain && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary/60">
                    {domainLabel(t, project.domain)}
                  </span>
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
          <ResearchProjectForm onClose={handleCloseForm} editing={editing ?? undefined} />
        </Suspense>
      )}
    </div>
  );
}
