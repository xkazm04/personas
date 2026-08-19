// Patterns — the Overview host for the knowledge surfaces. Three lanes
// (persisted per device, `Subjects` default):
//
// - **Subjects** — the v2 knowledge hierarchy (Golden Paths → Techniques →
//   Applications → Evidence), read live from a managed repo's
//   `docs/concepts/paths/**` by the Rust reader. Needs only a project id —
//   no workspace.
// - **Graph** — the hierarchy graph (P3): the same corpus rendered as a
//   Nexus-style sky (8 category keystones → subjects → techniques). Also
//   project-scoped, no workspace dependency.
// - **Practices** — the pre-existing workspace practice library (DB plane),
//   untouched, with its OWN internal Library|Graph toggle restored so the old
//   Nexus over workspace practices stays reachable there.
import { useEffect, useMemo, useState } from 'react';

import { listWorkspaceKnowledge } from '@/api/devTools/workspaces';
import {
  refreshWorkspaces,
  setActiveWorkspace,
  useWorkspaces,
} from '@/features/plugins/dev-tools/sub_workspaces/workspaceStore';
import { IllustratedEmptyState } from '@/features/shared/components/display/IllustratedEmptyState';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { ContentHeaderSkeleton } from '@/features/shared/components/layout/ContentHeaderSkeleton';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import HierarchyGraphHost from './hierarchy/graph/HierarchyGraphHost';
import { SubjectsView, type SubjectsFocusRequest } from './hierarchy/SubjectsView';
import KnowledgeLibrary from './KnowledgeLibrary';

type Lane = 'subjects' | 'graph' | 'practices';

const LANE_KEY = 'patterns:lane';

function initialLane(): Lane {
  try {
    const stored = localStorage.getItem(LANE_KEY);
    if (stored === 'subjects' || stored === 'graph' || stored === 'practices') return stored;
  } catch (err) {
    // localStorage unavailable — default lane.
    silentCatch('patterns:laneRead')(err);
  }
  return 'subjects';
}

/** Calm header-only ghost, same shape as the KnowledgeHub subtab fallback:
 *  the library's body geometry (tree + grid) is too distinctive to fake
 *  without producing a skeleton-mismatch blink. */
function PatternsSkeleton() {
  return (
    <div aria-hidden="true" className="flex-1 min-h-0 flex flex-col animate-fade-in" style={{ animationDelay: '150ms' }}>
      <ContentBox>
        <ContentHeaderSkeleton showIcon showSubtitle calm />
      </ContentBox>
    </div>
  );
}

/** The pre-existing workspace-practices plane, exactly as before the lane
 *  restructure: workspace gating/skeleton and the workspace picker live HERE,
 *  so the hierarchy lanes never wait on (or render) any of it. No controlled
 *  `view` — KnowledgeLibrary's internal Library|Graph toggle is back, which
 *  keeps the old Nexus reachable inside this lane. */
function WorkspaceLane() {
  const { t } = useTranslation();
  const tk = t.overview.knowledge;
  const { workspaces, activeId } = useWorkspaces();
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

  // The store hydrates lazily on first subscribe, so an empty `workspaces` is
  // ambiguous between "still loading" and "none exist". Drive our own refresh
  // once so the two states are distinguishable and the empty state is honest.
  const [workspacesReady, setWorkspacesReady] = useState(false);
  useEffect(() => {
    let live = true;
    refreshWorkspaces()
      .catch(silentCatch('patterns:refreshWorkspaces'))
      .finally(() => { if (live) setWorkspacesReady(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (projects.length === 0) void fetchProjects();
  }, [projects.length, fetchProjects]);

  // A persisted active workspace is a per-device preference and can be null
  // (the "all projects" sentinel used by the switchers). Patterns always shows
  // exactly one library, so fall back to the first workspace.
  const workspace = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? workspaces[0] ?? null,
    [workspaces, activeId],
  );
  const workspaceId = workspace?.id ?? null;

  const [rows, setRows] = useState<WorkspaceKnowledge[]>([]);
  const [rowsReady, setRowsReady] = useState(false);
  const [fetchGen, setFetchGen] = useState(0);

  useEffect(() => {
    if (!workspaceId) { setRows([]); setRowsReady(true); return; }
    let live = true;
    void fetchGen; // re-run on refresh
    listWorkspaceKnowledge(workspaceId)
      .then((next) => { if (live) { setRows(next); setRowsReady(true); } })
      .catch((err) => {
        silentCatch('patterns:knowledgeFetch')(err);
        if (live) setRowsReady(true);
      });
    return () => { live = false; };
  }, [workspaceId, fetchGen]);

  const projectById = useMemo(
    () => new Map<string, DevProject>(projects.map((p) => [p.id, p])),
    [projects],
  );

  if (!workspacesReady || (workspaceId !== null && !rowsReady)) {
    return <PatternsSkeleton />;
  }

  if (!workspace) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-6">
        <IllustratedEmptyState
          variant="routines"
          heading={tk.patterns_no_workspace_title}
          description={tk.patterns_no_workspace_desc}
        />
      </div>
    );
  }

  return (
    <>
      {workspaces.length > 1 && (
        <div className="flex-shrink-0">
          <SegmentedTabs<string>
            tabs={workspaces.map((w) => ({
              id: w.id,
              label: (
                <>
                  <span
                    className="w-2.5 h-2.5 rounded-interactive flex-shrink-0"
                    style={{ background: w.color }}
                    aria-hidden
                  />
                  {w.name}
                </>
              ),
              ariaLabel: w.name,
            }))}
            activeTab={workspace.id}
            onTabChange={setActiveWorkspace}
            ariaLabel={tk.patterns_workspace_picker}
            fullWidth={false}
            size="sm"
          />
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        <KnowledgeLibrary
          key={workspace.id}
          workspace={workspace}
          rows={rows}
          projectById={projectById}
          onChanged={() => setFetchGen((g) => g + 1)}
        />
      </div>
    </>
  );
}

export default function PatternsPanel() {
  const { t } = useTranslation();
  const p = t.overview.patterns_v2;
  const [lane, setLane] = useState<Lane>(initialLane);
  // Cross-lane navigation: the graph's "Open in Subjects" hands a focus
  // request across; a fresh object per navigation re-triggers the effect.
  const [subjectsFocus, setSubjectsFocus] = useState<SubjectsFocusRequest | null>(null);

  const pickLane = (next: Lane) => {
    setLane(next);
    try {
      localStorage.setItem(LANE_KEY, next);
    } catch (err) {
      // Persistence is a convenience, never a blocker.
      silentCatch('patterns:laneWrite')(err);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4 md:p-6 gap-3">
      <div className="flex-shrink-0">
        <SegmentedTabs<Lane>
          tabs={[
            { id: 'subjects', label: p.lane_subjects },
            { id: 'graph', label: p.lane_graph },
            { id: 'practices', label: p.lane_practices },
          ]}
          activeTab={lane}
          onTabChange={pickLane}
          ariaLabel={p.lane_switch_aria}
          fullWidth={false}
        />
      </div>

      {lane === 'subjects' ? (
        <SubjectsView focusSubject={subjectsFocus} />
      ) : lane === 'graph' ? (
        <HierarchyGraphHost
          onOpenInSubjects={(slug, technique) => {
            setSubjectsFocus({ slug, technique });
            pickLane('subjects');
          }}
        />
      ) : (
        <WorkspaceLane />
      )}
    </div>
  );
}
