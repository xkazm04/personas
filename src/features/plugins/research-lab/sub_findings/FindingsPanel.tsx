import { useEffect, useState, lazy, Suspense, useMemo } from 'react';
import { Target, Trash2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { SectionHeader } from '../shared/SectionHeader';
import { EmptyState, NoActiveProject } from '../shared/EmptyState';
import { SignalMeter } from '../shared/SignalMeter';
import type { ResearchFinding } from '@/api/researchLab/researchLab';

/** Rows in the first viewport that play the one-shot entrance cascade. */
const CASCADE_ROWS = 14;

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

  // A project switch replays the first-viewport cascade for its findings;
  // a refresh/poll re-delivering the same ids does not.
  const enter = useRevealTracker(activeProjectId ?? 'none');
  const showGhost = loading && projectFindings.length === 0;

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
        extra={<span className="typo-caption text-foreground">{projectFindings.length}</span>}
      />

      {showGhost ? (
        <FindingGhostRows />
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
          {projectFindings.map((f: ResearchFinding, index) => (
            <RevealItem
              key={f.id}
              revealId={f.id}
              order={index}
              hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)}
              markEntered={enter.markEntered}
              className="rounded-card bg-secondary/50 border border-border/30 p-4 hover:border-primary/30 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <Target className="w-4 h-4 text-cyan-400/80 mt-1 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <h3 className="typo-card-label">{f.title}</h3>
                  {f.description && (
                    <p className="typo-body text-foreground mt-1.5 line-clamp-3">{f.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {f.category && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/15 text-cyan-300">{f.category}</span>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary">
                      {f.status.replace(/_/g, ' ')}
                    </span>
                    <span className="flex items-center gap-1.5 typo-caption text-foreground">
                      {t.research_lab.confidence}
                      <SignalMeter value={f.confidence} ariaLabel={t.research_lab.confidence} widthClass="w-12" />
                    </span>
                    {f.generatedBy && (
                      <span className="typo-caption text-foreground">· {f.generatedBy}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(e, f.id)}
                  className="p-1 rounded opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-red-500/10 text-red-400/60 hover:text-red-400 transition-all focus-ring flex-shrink-0"
                  title={t.common.delete}
                  aria-label={t.common.delete}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </RevealItem>
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

// ---------------------------------------------------------------------------
// FindingGhostRows — calm ghost rows for the ONLY moment the finding list
// has nothing to show. Delayed `animate-fade-in` entrance (120ms+ stagger);
// no `animate-pulse`.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
const GHOST_TITLE_WIDTHS = ['w-52', 'w-40', 'w-56'];

function FindingGhostRows() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-card bg-secondary/50 border border-border/30 p-4 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <div className="flex items-start gap-3">
            <span className="w-4 h-4 rounded bg-primary/[0.06] mt-1 flex-shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <span className={`block h-3.5 ${GHOST_TITLE_WIDTHS[i % GHOST_TITLE_WIDTHS.length]} max-w-full ${GHOST_BAR}`} />
              <span className="block h-2.5 w-44 rounded bg-primary/[0.04]" />
              <div className="flex items-center gap-2 mt-3">
                <span className="h-4 w-14 rounded-full bg-primary/[0.06]" />
                <span className="h-4 w-16 rounded-full bg-primary/[0.06]" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
