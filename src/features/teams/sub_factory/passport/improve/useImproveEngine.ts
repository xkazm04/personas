// The Improve engine, extracted from ProjectsLayer (round-12 Mastermind reuse)
// so any surface with passport raw data (the Wall, the Mastermind canvas) can
// provide the identical row-action machinery. Behaviour is a verbatim lift:
// Tier-0 standards writes, context scans + activity dock, connector binds,
// skills installs, and Claude-Code deploy dispatch with dock + busy-cell
// resolution via eventBridge.
import { useMemo } from 'react';

import { setStandardsConfig, scanCodebase, createTask, executeTask, updateProject, installSkill } from '@/api/devTools/devTools';
import { useOverviewStore } from '@/stores/overviewStore';
import { useImproveActivityStore } from '@/stores/improveActivityStore';

import type { ImproveEngine, ImproveRaw } from './ImproveContext';

export function useImproveEngine(rawByProject: Map<string, ImproveRaw>, reload: () => void): ImproveEngine {
  return useMemo<ImproveEngine>(() => ({
    getRaw: (slug) => rawByProject.get(slug),
    allRaw: () => [...rawByProject.values()],
    applyStandards: async (slug, json) => { await setStandardsConfig(slug, json); reload(); },
    runContextScan: async (slug) => {
      const raw = rawByProject.get(slug);
      if (!raw) return undefined;
      const { scan_id } = await scanCodebase(slug, raw.project.root_path);
      // Register in the global activity dock (titlebar) so the scan stays
      // visible while the user navigates across modules; completion is resolved
      // globally in eventBridge (CONTEXT_GEN_COMPLETE → factory_scan). The Rust
      // side runs the scan detached, so scanCodebase returns a scan_id at once.
      useOverviewStore.getState().processStarted(
        'factory_scan',
        scan_id,
        `Context scan: ${raw.project.name}`,
        { section: 'plugins', tab: 'context-map' },
      );
      return scan_id;
    },
    bindConnector: async (slug, credId, field) => {
      const updates =
        field === 'pr' ? { prCredentialId: credId }
        : field === 'llm_tracking' ? { llmTrackingCredentialId: credId }
        : { monitoringCredentialId: credId };
      await updateProject(slug, updates);
      reload();
    },
    installSkills: async (slug, items) => {
      await Promise.all(items.map((it) => installSkill(it.name, it.source, slug, false)));
      reload();
    },
    queueTask: async (slug, title, prompt) => { await createTask(title, slug, prompt); },
    deployNow: async (slug, title, prompt) => {
      const raw = rawByProject.get(slug);
      const task = await createTask(title, slug, prompt);
      // Surface the Claude-Code run in the global activity dock keyed by task id,
      // deep-linking to the Task Runner where its output streams live (same
      // surface as every other Claude-Code CLI execution). The run dispatches
      // detached on the Rust side; its terminal status (completed/failed/
      // cancelled) is resolved globally in eventBridge → factory_deploy, which
      // also raises the completion notification, so the user can switch modules
      // and be told when the LLM is done.
      const ov = useOverviewStore.getState();
      ov.processStarted(
        'factory_deploy',
        task.id,
        `Upgrade ${raw?.project.name ?? 'project'}: ${title}`,
        { section: 'plugins', tab: 'task-runner' },
      );
      try {
        await executeTask(task.id);
      } catch (e) {
        // executeTask only rejects on dispatch failure (before any event), so
        // settle the dock entry + un-busy the cell here; in-run terminal states
        // arrive via events.
        ov.processEnded('factory_deploy', 'failed', task.id);
        useImproveActivityStore.getState().endByRun(task.id);
        throw e;
      }
      return task.id;
    },
  }), [rawByProject, reload]);
}
