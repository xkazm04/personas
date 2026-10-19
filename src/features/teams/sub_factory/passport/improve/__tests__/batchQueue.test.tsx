import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CrossProjectProjectMetadata, RepoEvidence } from '@/api/devTools/devTools';
import type { DevProject } from '@/lib/bindings/DevProject';
import { useToastStore } from '@/stores/toastStore';

import { ImproveProvider, type ImproveEngine, type ImproveRaw } from '../ImproveContext';
import { ImprovePlanPanel } from '../ImprovePlanPanel';
import { useImproveActions } from '../useImproveActions';

function mkRaw(id: string): ImproveRaw {
  return {
    meta: {
      project_id: id, name: id, summary: '', keywords: [], api_surface: [],
      tech_layers: ['typescript'], db_tables: [], context_count: 30, group_count: 0, active_goal_count: 0,
    } as CrossProjectProjectMetadata,
    project: {
      id, name: id, root_path: `C:/${id}`, description: null, status: 'active', tech_stack: 'react',
      github_url: null, monitoring_credential_id: null, pr_credential_id: null,
      llm_tracking_credential_id: null, test_env_url: null, standards_config: null, team_id: null,
    } as DevProject,
    // Nothing detected: every Claude-deploy row is a gap.
    evidence: { scanned: true, package_scripts: [], ci_workflows: [] } as RepoEvidence,
  };
}

/** queueTask fails on exactly the `failOn`-th call; records every success. */
function mkEngine(raws: ImproveRaw[], failOn: number) {
  const queued: string[] = [];
  let calls = 0;
  const engine: ImproveEngine = {
    getRaw: (slug) => raws.find((r) => r.project.id === slug),
    allRaw: () => raws,
    applyStandards: vi.fn(),
    runContextScan: vi.fn(),
    bindConnector: vi.fn(),
    setDataLinks: vi.fn(),
    queueTask: vi.fn(async (slug: string, title: string) => {
      calls += 1;
      if (calls === failOn) throw { error: 'database is locked', kind: 'Database' };
      queued.push(`${slug}|${title}`);
    }),
    deployNow: vi.fn(),
  };
  return { engine, queued };
}

const toasts = () => useToastStore.getState().toasts.map((t) => `${t.type}:${t.message}`);

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('ImprovePlanPanel campaign queue', () => {
  it('a retry after a mid-campaign failure does not queue the already-queued tasks again', async () => {
    const raws = [mkRaw('alpha')];
    const { engine, queued } = mkEngine(raws, 2);
    const wrap = ({ children }: { children: ReactNode }) => <ImproveProvider value={engine}>{children}</ImproveProvider>;
    render(<ImprovePlanPanel open onClose={vi.fn()} />, { wrapper: wrap });

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(2);
    for (const box of boxes) fireEvent.click(box);
    const queueBtn = () => screen.getByRole('button', { name: /^Queue \d+ selected$/ });
    await act(async () => { fireEvent.click(queueBtn()); });
    await waitFor(() => expect(toasts().some((t) => t.startsWith('error:'))).toBe(true));
    // The one task before the failure WAS queued, and the panel says so.
    expect(queued).toHaveLength(1);
    expect(toasts()).toContain('success:Queued 1 golden-standard task across the fleet');

    await act(async () => { fireEvent.click(queueBtn()); });
    // Every selected task exactly once: the first run's one + the retry's rest.
    await waitFor(() => expect(queued.length).toBeGreaterThanOrEqual(boxes.length));
    expect(queued).toHaveLength(boxes.length);
    expect(new Set(queued).size).toBe(queued.length);
  });
});

describe('useImproveActions.runBatch', () => {
  it('reports the projects that WERE queued when one of the batch fails', async () => {
    const raws = [mkRaw('alpha'), mkRaw('beta'), mkRaw('gamma')];
    const { engine, queued } = mkEngine(raws, 2);
    const onDone = vi.fn();
    const wrap = ({ children }: { children: ReactNode }) => <ImproveProvider value={engine}>{children}</ImproveProvider>;
    const { result } = renderHook(() => useImproveActions('alpha', 'tests', onDone), { wrapper: wrap });
    const action = result.current!.actions[0]!;
    expect(result.current!.batchSize(action)).toBe(3);

    await act(async () => { await result.current!.runBatch(action); });
    expect(queued).toHaveLength(2);
    expect(toasts()).toContain(`success:Queued “${action.label}” for 2 projects`);
    expect(toasts().some((t) => t.startsWith('error:'))).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
