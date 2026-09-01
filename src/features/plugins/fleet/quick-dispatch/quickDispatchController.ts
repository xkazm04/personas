import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useSystemStore } from '@/stores/systemStore';
import { companionDispatchFleetPlan } from '@/api/companion';
import { renameSession, spawnHeadlessSession } from '@/api/fleet/fleet';
import {
  listProjects,
  listSkills,
  type DevProject,
  type SkillEntry,
} from '@/api/devTools/devTools';
import { skillCommand } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { silentCatch } from '@/lib/silentCatch';
import {
  activeTypeaheadToken,
  dispatchIntentOf,
  filterQuickDispatchProjects,
  filterQuickDispatchSkills,
  stripActiveToken,
} from './quickDispatchTypeahead';
import {
  quickDispatchOptionId,
  type QuickDispatchSuggestion,
} from './QuickDispatchSuggestions';

/**
 * The Quick Dispatch composer's whole brain, hoisted out of the overlay so the
 * prototyping variants are pure presentation. Everything behavioral — the
 * `@`/`/` typeahead grammar, chip lifecycle, keyboard capture, the dispatch
 * door call (interactive + headless fallback), the recent-sessions snapshot,
 * ARIA stamping — lives here; a variant decides only WHERE things render.
 *
 * The controller is instantiated per mounted host, and the reset effect runs
 * once on mount — a host that mounts the composer IS the summon. There is no
 * longer a summoned variant: the Quick Dispatch overlay was retired once the
 * Monitor grew its own docked console, so `inline` had one live value and an
 * open-flag store nothing could set.
 */

export const QUICK_DISPATCH_LISTBOX_ID = 'quick-dispatch-typeahead-listbox';

export interface QuickDispatchOptions {
  /**
   * DOM id for the typeahead listbox, stamped into the textarea's
   * `aria-controls` / `aria-activedescendant`. Defaults to the module constant.
   * A second host mounted at the same time MUST pass its own, or the two
   * composers advertise the same id and the ARIA reference resolves to
   * whichever painted first.
   */
  listboxId?: string;
}

/** Cycle presets for the model chip. `null` = leave the CLI default. */
export const MODEL_PRESETS: ReadonlyArray<string | null> = [null, 'haiku', 'sonnet', 'opus'];

/** Cycle presets for the effort chip. `null` = CLI default. */
export const EFFORT_PRESETS: ReadonlyArray<string | null> = [null, 'low', 'medium', 'high', 'xhigh'];

/** Server bound on the dispatch door (see `companion_dispatch_fleet_plan`). */
const OBJECTIVE_MAX = 1200;

const cycleNext = <T,>(presets: ReadonlyArray<T>, current: T): T => {
  const idx = presets.indexOf(current);
  return presets[(idx + 1) % presets.length] as T;
};

export function useQuickDispatchController(options?: QuickDispatchOptions) {
  const { t, tx } = useTranslation();
  const listboxId = options?.listboxId ?? QUICK_DISPATCH_LISTBOX_ID;

  // No useShallow (zustand-domain-slices golden path, deviation A): bare
  // property selectors; a refetched list holds fresh objects anyway.
  const sessions = useSystemStore((s) => s.fleetSessions);
  const fleetSessionsLoading = useSystemStore((s) => s.fleetSessionsLoading);
  const fleetStartSessionListeners = useSystemStore((s) => s.fleetStartSessionListeners);
  const fleetRefresh = useSystemStore((s) => s.fleetRefresh);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setPluginTab = useSystemStore((s) => s.setPluginTab);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);

  const [value, setValue] = useState('');
  const [projectChip, setProjectChip] = useState<DevProject | null>(null);
  const [skillChip, setSkillChip] = useState<SkillEntry | null>(null);
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [headless, setHeadless] = useState(false);
  const [sending, setSending] = useState(false);
  // Kept as-is; coerced only at the resolver boundary (error-message-resolution
  // golden path) so the producer's discriminant survives to the resolver.
  const [rawError, setRawError] = useState<unknown>(null);
  const [justDispatched, setJustDispatched] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      cardRef.current?.querySelector('textarea')?.focus();
    });
  }, []);

  // CommandPalette's focus idiom: reset, then focus on the next frame. Also
  // warm the project registry + the fleet session snapshot. Runs once per
  // mount — the host mounting this composer is what "summoned" used to mean.
  useEffect(() => {
    setValue('');
    setProjectChip(null);
    setSkillChip(null);
    setModel(null);
    setEffort(null);
    setHeadless(false);
    setSending(false);
    setRawError(null);
    setJustDispatched(false);
    setActiveIndex(0);
    focusInput();
    listProjects()
      .then(setProjects)
      .catch(silentCatch('quick dispatch: list projects'));
    fleetStartSessionListeners();
    void fleetRefresh();
  }, [focusInput, fleetStartSessionListeners, fleetRefresh]);

  // Skill typeahead is scoped to the picked project.
  useEffect(() => {
    if (!projectChip) {
      setSkills([]);
      return;
    }
    listSkills(projectChip.id)
      .then(setSkills)
      .catch(silentCatch('quick dispatch: list skills'));
  }, [projectChip]);

  useEffect(() => {
    if (!justDispatched) return;
    const id = setTimeout(() => setJustDispatched(false), 4000);
    return () => clearTimeout(id);
  }, [justDispatched]);

  // Deliberately a SIBLING of `plugins.fleet` (that section is a flat string
  // map indexed via `keyof`; nesting breaks those lookups).
  const quickT = t.plugins.fleet_quick_dispatch;

  const token = useMemo(() => activeTypeaheadToken(value), [value]);

  const filteredProjects = useMemo(
    () => (token?.kind === 'project' ? filterQuickDispatchProjects(projects, token.query) : []),
    [token, projects],
  );
  const filteredSkills = useMemo(
    () =>
      token?.kind === 'skill' && projectChip
        ? filterQuickDispatchSkills(skills, token.query)
        : [],
    [token, projectChip, skills],
  );

  const suggestions = useMemo<QuickDispatchSuggestion[]>(() => {
    if (token?.kind === 'project') {
      return filteredProjects.map((p) => ({ id: p.id, label: p.name, description: p.root_path }));
    }
    if (token?.kind === 'skill' && projectChip) {
      return filteredSkills.map((s) => ({ id: s.path, label: `/${s.name}`, description: s.description }));
    }
    return [];
  }, [token, filteredProjects, filteredSkills, projectChip]);

  const suggestionHint =
    token?.kind === 'skill' && !projectChip
      ? quickT.skill_needs_project
      : token && suggestions.length === 0
        ? token.kind === 'project'
          ? quickT.no_project_matches
          : quickT.no_skill_matches
        : null;

  // Clamp/reset the arrow cursor whenever the filter changes the list.
  useEffect(() => {
    setActiveIndex(0);
  }, [token?.kind, token?.query]);

  // ChatInputBar owns the <textarea> with no ARIA pass-through; the combobox
  // half of the contract is stamped imperatively. INVARIANT: each variant
  // renders exactly one textarea inside `cardRef`.
  useEffect(() => {
    const ta = cardRef.current?.querySelector('textarea');
    if (!ta) return;
    if (token) {
      ta.setAttribute('role', 'combobox');
      ta.setAttribute('aria-expanded', suggestions.length > 0 ? 'true' : 'false');
      ta.setAttribute('aria-controls', listboxId);
      ta.setAttribute('aria-autocomplete', 'list');
      if (suggestions.length > 0) {
        ta.setAttribute(
          'aria-activedescendant',
          quickDispatchOptionId(listboxId, Math.min(activeIndex, suggestions.length - 1)),
        );
      } else {
        ta.removeAttribute('aria-activedescendant');
      }
    } else {
      ta.removeAttribute('role');
      ta.removeAttribute('aria-expanded');
      ta.removeAttribute('aria-controls');
      ta.removeAttribute('aria-autocomplete');
      ta.removeAttribute('aria-activedescendant');
    }
  }, [token, suggestions.length, activeIndex, listboxId]);

  const pickSuggestion = useCallback(
    (item: QuickDispatchSuggestion) => {
      if (token?.kind === 'project') {
        const project = filteredProjects.find((p) => p.id === item.id);
        if (!project) return;
        setValue((v) => stripActiveToken(v));
        // A different @project invalidates the skill chip.
        if (projectChip && projectChip.id !== project.id) setSkillChip(null);
        setProjectChip(project);
      } else if (token?.kind === 'skill') {
        const skill = filteredSkills.find((s) => s.path === item.id);
        if (!skill) return;
        setValue((v) => stripActiveToken(v));
        setSkillChip(skill);
      }
      setActiveIndex(0);
      focusInput();
    },
    [token, filteredProjects, filteredSkills, projectChip, focusInput],
  );

  const removeSkillChip = useCallback(() => setSkillChip(null), []);
  const removeProjectChip = useCallback(() => {
    // Skill chips are project-scoped; they cannot outlive the project chip.
    setProjectChip(null);
    setSkillChip(null);
  }, []);

  // Typeahead navigation + chip editing, in the CAPTURE phase so it runs
  // before ChatInputBar's Enter-submits and the variant's Escape-closes.
  const onComposerKeyDownCapture = useCallback(
    (e: React.KeyboardEvent) => {
      if (token) {
        if (e.key === 'ArrowDown' && suggestions.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          setActiveIndex((i) => (i + 1) % suggestions.length);
          return;
        }
        if (e.key === 'ArrowUp' && suggestions.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          // While a token is open, Enter picks — never dispatches a draft that
          // still ends in a half-typed `@`/`/` token.
          e.preventDefault();
          e.stopPropagation();
          const pick = suggestions[Math.min(activeIndex, suggestions.length - 1)];
          if (pick) pickSuggestion(pick);
          return;
        }
        if (e.key === 'Escape') {
          // First Escape strips the token; the next one closes the overlay.
          e.preventDefault();
          e.stopPropagation();
          setValue((v) => stripActiveToken(v));
          return;
        }
      }
      if (e.key === 'Backspace' && value === '' && (skillChip || projectChip)) {
        e.preventDefault();
        if (skillChip) removeSkillChip();
        else removeProjectChip();
      }
    },
    [
      token,
      suggestions,
      activeIndex,
      pickSuggestion,
      value,
      skillChip,
      projectChip,
      removeSkillChip,
      removeProjectChip,
    ],
  );

  const requirement = value.trim();
  const canSend = !!projectChip && requirement.length > 0 && !sending && !token;

  const handleSubmit = useCallback(async () => {
    if (!projectChip || !requirement || sending || token) return;
    const objective = requirement.slice(0, OBJECTIVE_MAX);
    setSending(true);
    setRawError(null);
    setJustDispatched(false);
    try {
      if (headless) {
        // AGREED COMPROMISE: the dispatch door is PTY-interactive only, so
        // background dispatches fall back to the fleet headless lane. These
        // sessions SKIP the Athena-owned operation / notify lane — the caption
        // under the toggle says so.
        const prompt = skillChip ? skillCommand(skillChip.name, objective) : objective;
        const args = [
          ...(model ? ['--model', model] : []),
          ...(effort ? ['--effort', effort] : []),
        ];
        const sessionId = await spawnHeadlessSession(
          projectChip.root_path,
          prompt,
          args.length > 0 ? args : undefined,
        );
        // Address the session (agent-dispatch golden path): a key recomputable
        // from entity ids, stamped into the session name.
        await renameSession(
          sessionId,
          `quick:${projectChip.id}${skillChip ? `:${skillChip.name}` : ''}`,
        );
      } else {
        await companionDispatchFleetPlan(
          dispatchIntentOf(objective),
          [
            {
              cwd: projectChip.root_path,
              objective,
              skill: skillChip?.name ?? null,
              label: null,
              model: model ?? null,
              effort: effort ?? null,
            },
          ],
          undefined,
          'quick_dispatch',
        );
      }
      setValue('');
      setJustDispatched(true);
      // Refresh explicitly so the recent list shows the new session right away.
      void fleetRefresh();
    } catch (err) {
      // Inline (not a toast): the overlay floats above everything, so a toast
      // behind it is invisible. The draft is kept for correction.
      setRawError(err);
    } finally {
      setSending(false);
    }
  }, [projectChip, requirement, sending, token, headless, skillChip, model, effort, fleetRefresh]);

  const openFleetPage = useCallback(() => {
    // Same deep-link the fleet footer icon uses.
    setSidebarSection('plugins');
    setPluginTab('dev-tools');
    setDevToolsTab('fleet');
  }, [setSidebarSection, setPluginTab, setDevToolsTab]);

  // Quick-dispatched sessions are recognizable by the door's `athena` naming
  // sentinel; when none exist yet, fall back to the most recent of any origin.
  const recent = useMemo(() => {
    const athenaOwned = sessions.filter((s) => s.name?.startsWith('athena'));
    const pool = athenaOwned.length > 0 ? athenaOwned : sessions;
    return [...pool]
      .sort((a, b) => Number(b.createdAtMs) - Number(a.createdAtMs))
      .slice(0, 6);
  }, [sessions]);

  const translatedError =
    rawError == null
      ? null
      : resolveErrorTranslated(t, typeof rawError === 'string' ? rawError : String(rawError));

  // Studio's stateShadow idiom: blue inner glow while a dispatch is in flight.
  const stateShadow = sending
    ? 'inset 0 0 0 1px rgba(96,165,250,0.50), inset 0 1px 14px rgba(96,165,250,0.18), 0 8px 24px -8px rgba(0,0,0,0.45)'
    : undefined;

  const cycleModel = useCallback(() => setModel((m) => cycleNext(MODEL_PRESETS, m)), []);
  const cycleEffort = useCallback(() => setEffort((e) => cycleNext(EFFORT_PRESETS, e)), []);
  const toggleHeadless = useCallback(() => setHeadless((v) => !v), []);

  return {
    t,
    tx,
    quickT,
    cardRef,
    /** The typeahead listbox's DOM id — the panel half of the combobox contract.
     *  Render `QuickDispatchSuggestions` with THIS, never the constant. */
    listboxId,
    /** Focus the composer's textarea on the next frame. Exported for hosts that
     *  reveal the input themselves (the docked console expands into it). */
    focusInput,
    value,
    setValue,
    projectChip,
    skillChip,
    removeProjectChip,
    removeSkillChip,
    token,
    suggestions,
    suggestionHint,
    activeIndex,
    setActiveIndex,
    pickSuggestion,
    onComposerKeyDownCapture,
    model,
    cycleModel,
    effort,
    cycleEffort,
    headless,
    toggleHeadless,
    sending,
    canSend,
    handleSubmit,
    justDispatched,
    translatedError,
    stateShadow,
    recent,
    fleetSessionsLoading,
    openFleetPage,
  };
}

export type QuickDispatchController = ReturnType<typeof useQuickDispatchController>;
