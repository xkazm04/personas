// Row models + the one assembly hook behind every Skills surface.
//
// This was inline in SkillsManagerPage, which made it reachable only from the
// Dev Tools page — so the Mastermind canvas grew a parallel, thinner skills UI
// instead. Hoisted here so the page's Overview tab, the page's Analytics tab
// and the canvas's Skills modal all derive rows and run operations through the
// SAME code path.
//
// Requires an `ImproveProvider` above the consumer: adopt/share dispatch
// Dev-runner tasks through the improve engine.
import { useMemo } from 'react';

import type { SkillCoverageRow, SkillEntry, SkillUsageRow } from '@/api/devTools/devTools';
import { skillCommand } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import type { RegistryLibrary } from '../sub_workspaces/registry/useRegistryLibrary';
import { useTranslation } from '@/i18n/useTranslation';

import { isPresetSkill, presetSkillEntry, PRESET_SKILLS } from '../constants/presetSkills';
import { useSkillsManagerData, type MemoryBinding } from './skillsManagerData';
import type { UseSkillChoice } from './UseSkillDialog';

/** Workspace-side row model. */
export interface WsRow {
  entry: SkillEntry;
  usage: SkillUsageRow | undefined;
  /** Already installed in the active project (row dims, no adopt action). */
  installed: boolean;
}

/** Project-side row model. */
export interface ProjRow {
  entry: SkillEntry;
  usage: SkillUsageRow | undefined;
  /** The library doesn't have it — the share affordance shows. */
  shareable: boolean;
  coverage: SkillCoverageRow | undefined;
  /** Context-related: declared (`contexts: tracked`) OR evidenced (coverage). */
  tracked: boolean;
}

/** The props every Skills board/variant consumes. */
export interface SkillsManagerVariantProps {
  ws: WsRow[];
  proj: ProjRow[];
  /** Where the library came from — the Library panel needs this to tell an
   *  unwired workspace apart from a registry that publishes no skills. */
  library: RegistryLibrary;
  totalContexts: number;
  busy: boolean;
  projectName: string;
  /** Active project id — the Use dialog needs it to fetch contexts. */
  projectId: string | null;
  onAdopt: (name: string) => void;
  onShare: (name: string) => void;
  /** Project side — run the installed skill with the operator's dispatch-target
   *  + context choice (see UseSkillChoice). */
  onUse: (name: string, choice: UseSkillChoice) => void;
  /** Project-side rows only — the host binds the active project id. */
  onSwitchMemory: (skillName: string, next: MemoryBinding) => void;
  onOpenContexts: (skill: string) => void;
  /** Skill-name click → the shared metadata modal. */
  onOpenInfo: (skill: string) => void;
}

/** Everything a Skills surface needs, minus the two detail modals (which are
 *  view state, so each surface owns its own). */
export interface SkillsManagerRows {
  ws: WsRow[];
  proj: ProjRow[];
  library: RegistryLibrary;
  totalContexts: number;
  busy: boolean;
  projectName: string;
  onAdopt: (name: string) => void;
  onShare: (name: string) => void;
  onUse: (name: string, choice: UseSkillChoice) => void;
  onSwitchMemory: (skillName: string, next: MemoryBinding) => void;
  /** Bare Fleet dispatch (`/skill args`) — the Analytics tab's action. */
  onDispatch: (skill: string, args: string) => void;
}

export function useSkillsManagerRows(projectId: string | null): SkillsManagerRows {
  const { t, tx } = useTranslation();
  const projects = useSystemStore((s) => s.projects);
  const addToast = useToastStore((s) => s.addToast);
  const { copy } = useCopyToClipboard();
  const data = useSkillsManagerData(projectId);

  const projectName = projects.find((p) => p.id === projectId)?.name ?? '';

  const ws: WsRow[] = useMemo(() => {
    const rows: WsRow[] = data.workspaceSkills.map((entry) => ({
      entry,
      usage: data.usageGlobal.get(entry.name),
      installed: data.installedNames.has(entry.name),
    }));
    // The Preset tab always shows the full app-owned catalog — synthesize rows
    // for presets not materialized in the user's global library.
    const have = new Set(rows.map((r) => r.entry.name));
    for (const p of PRESET_SKILLS.values()) {
      if (have.has(p.name)) continue;
      rows.push({
        entry: presetSkillEntry(p),
        usage: data.usageGlobal.get(p.name),
        installed: data.installedNames.has(p.name),
      });
    }
    return rows;
  }, [data.workspaceSkills, data.usageGlobal, data.installedNames]);

  const shareableNames = useMemo(
    () => new Set((data.wb?.share.items ?? []).map((s) => s.name)),
    [data.wb],
  );

  const proj: ProjRow[] = useMemo(
    () => data.projectSkills.map((entry) => ({
      entry,
      usage: data.usageProject.get(entry.name),
      shareable: shareableNames.has(entry.name),
      coverage: data.coverageBySkill.get(entry.name),
      tracked: entry.contextTracked || data.coverageBySkill.has(entry.name),
    })),
    [data.projectSkills, data.usageProject, shareableNames, data.coverageBySkill],
  );

  // Presets install from the app bundle (system-skill lane) — not via the
  // Dev-runner adopt task, which sources from the user's global library.
  const onAdopt = (name: string) => {
    if (!isPresetSkill(name)) { void data.wb?.runAdopt(name); return; }
    if (!projectId) return;
    void (async () => {
      try {
        const { installSystemSkill } = await import('@/api/devTools/devTools');
        await installSystemSkill(name, projectId, false);
        addToast(tx(t.plugins.dev_tools.skills_preset_installed, { name }), 'success');
        data.refresh();
      } catch (err) {
        toastCatch('skillsManagerRows:installPreset')(err);
      }
    })();
  };

  // Route the operator's Use choice. The context term folds into the args as a
  // trailing positional (a "preset terminal input"); "all" runs one dispatch per
  // context. Fleet → wb.runDispatch (in-app session). Terminal → wb.runConsole,
  // which opens a real console window already cd'd to the repo root with the
  // Claude CLI running and the `/skill …` command seeded.
  //
  // Clipboard stays as the FALLBACK, not the happy path: console spawning is
  // Windows-only today and needs the Claude CLI on PATH (see
  // src-tauri/src/commands/fleet/external.rs). When it can't spawn, the operator
  // still gets the exact command, which is what they had before.
  const onUse = (name: string, choice: UseSkillChoice) => {
    const argSets = choice.contexts.length
      ? choice.contexts.map((c) => [choice.args, c].filter(Boolean).join(' '))
      : [choice.args];
    if (choice.target === 'cmd') {
      void (async () => {
        try {
          // ONE window for the whole batch — a console is a window the operator
          // closes by hand, so Fleet's one-session-per-context does not carry
          // over here. The session runs them sequentially; see consolePrompt.
          await data.wb?.runConsole(name, argSets);
          addToast(
            argSets.length > 1
              ? tx(t.plugins.dev_tools.skills_use_cmd_launched_batch, { n: argSets.length, name: projectName })
              : tx(t.plugins.dev_tools.skills_use_cmd_launched, { name: projectName }),
            'success',
          );
        } catch (e) {
          silentCatch('skillsManagerRows:runConsole')(e);
          copy(argSets.map((a) => `claude "${skillCommand(name, a)}"`).join(' && '));
          addToast(t.plugins.dev_tools.skills_use_cmd_fallback, 'warning');
        }
      })();
      return;
    }
    for (const a of argSets) void data.wb?.runDispatch(name, a);
  };

  return {
    ws,
    proj,
    library: data.library,
    totalContexts: data.totalContexts,
    busy: Boolean(data.wb?.managing),
    projectName,
    onAdopt,
    // A wired registry is where a share BELONGS: the library is that repo's
    // skills lane, so publishing into `~/.claude/skills` instead would put the
    // generalized copy somewhere the fleet never reads. Unwired keeps the home
    // library, which is the only place there is.
    onShare: (name) => {
      const reg = data.library.registry;
      void data.wb?.runShare(
        name,
        reg ? { kind: 'registry', clonePath: reg.clonePath, registryName: reg.fullName } : { kind: 'home' },
      );
    },
    onUse,
    onSwitchMemory: (skillName, next) => { if (projectId) void data.switchMemory(skillName, projectId, next); },
    onDispatch: (skill, args) => { void data.wb?.runDispatch(skill, args); },
  };
}
