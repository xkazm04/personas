import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Folder, Wand2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useQuickDispatchStore } from '@/stores/quickDispatchStore';
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
import { FLEET_STATE_META } from '../fleetStateMeta';
import {
  activeTypeaheadToken,
  dispatchIntentOf,
  filterQuickDispatchProjects,
  filterQuickDispatchSkills,
  stripActiveToken,
} from './quickDispatchTypeahead';
import {
  QuickDispatchSuggestions,
  quickDispatchOptionId,
  type QuickDispatchSuggestion,
} from './QuickDispatchSuggestions';

/**
 * Quick Dispatch overlay — the fastest path from "I want a session on X" to a
 * running fleet session, without leaving the current page.
 *
 * Opened by the nav-mode `C` key (see `TitleBarDock`); there is deliberately no
 * titlebar capsule for it. Mirrors the `CommandPalette` mounting idiom: an
 * unpainted `fixed inset-0` container (the paint lives on a separate
 * `absolute inset-0` scrim child, which is also what keeps this outside the
 * `hand-painted-modal-backdrop` census rule), a centered card at ~15vh, close
 * on scrim click and on Escape via a React `onKeyDown` inside the surface —
 * NOT a global keyboard claim.
 *
 * Composer grammar: `@` opens a project typeahead (required chip), `/` opens a
 * skill typeahead scoped to the picked project (optional chip). The rest of
 * the draft is the session objective. Interactive dispatches go through the
 * Athena-owned `companion_dispatch_fleet_plan` door with
 * `origin: "quick_dispatch"`; the headless toggle falls back to the fleet
 * headless lane (see the comment at the send path).
 */

const LISTBOX_ID = 'quick-dispatch-typeahead-listbox';

/** Cycle presets for the model chip. `null` = leave the CLI default. The ids
 *  mirror the repo-wide `ModelTier` (haiku/sonnet/opus) — the same aliases the
 *  fleet plan card and the Claude CLI's `--model` accept. */
const MODEL_PRESETS: ReadonlyArray<string | null> = [null, 'haiku', 'sonnet', 'opus'];

/** Cycle presets for the effort chip. `null` = CLI default; the rest is the
 *  server-validated `--effort` domain. */
const EFFORT_PRESETS: ReadonlyArray<string | null> = [null, 'low', 'medium', 'high', 'xhigh'];

/** Server bounds on the dispatch door (see `companion_dispatch_fleet_plan`). */
const OBJECTIVE_MAX = 1200;

const cycleNext = <T,>(presets: ReadonlyArray<T>, current: T): T => {
  const idx = presets.indexOf(current);
  return presets[(idx + 1) % presets.length] as T;
};

export default function QuickDispatchOverlay() {
  const { t, tx } = useTranslation();
  const open = useQuickDispatchStore((s) => s.open);
  const closeQuickDispatch = useQuickDispatchStore((s) => s.closeQuickDispatch);

  // No useShallow here (zustand-domain-slices golden path, deviation A): the
  // selector is a bare property access, and a refetched session list holds
  // fresh objects, so a shallow compare could never match anyway.
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
  // The rejection value is kept as-is and only coerced at the resolver
  // boundary (error-message-resolution golden path): stringifying in the catch
  // would destroy whatever discriminant the producer sent before the resolver
  // ever sees it.
  const [rawError, setRawError] = useState<unknown>(null);
  const [justDispatched, setJustDispatched] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      cardRef.current?.querySelector('textarea')?.focus();
    });
  }, []);

  // Same focus idiom as CommandPalette: reset, then focus on the next frame so
  // the field exists (and the entrance animation has committed) before focus.
  // Also warm the data this composer needs: the project registry for the `@`
  // typeahead and the fleet session snapshot for the recent list.
  useEffect(() => {
    if (!open) return;
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
  }, [open, focusInput, fleetStartSessionListeners, fleetRefresh]);

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

  // Deliberately a SIBLING of `plugins.fleet`, not nested inside it: the fleet
  // section is a flat string map that the fleet UI indexes via
  // `keyof Translations['plugins']['fleet']` (FleetStatusDots, monitorMeta, …),
  // and a nested object there breaks every one of those lookups.
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

  // Clamp/reset the arrow-key cursor whenever the filter changes the list.
  useEffect(() => {
    setActiveIndex(0);
  }, [token?.kind, token?.query]);

  // ChatInputBar owns the <textarea> and exposes no ARIA pass-through, so the
  // combobox half of the ARIA contract (the listbox half lives on the panel)
  // is stamped imperatively. INVARIANT: multiline ChatInputBar always renders
  // exactly one textarea inside the card.
  useEffect(() => {
    const ta = cardRef.current?.querySelector('textarea');
    if (!ta) return;
    if (token) {
      ta.setAttribute('role', 'combobox');
      ta.setAttribute('aria-expanded', suggestions.length > 0 ? 'true' : 'false');
      ta.setAttribute('aria-controls', LISTBOX_ID);
      ta.setAttribute('aria-autocomplete', 'list');
      if (suggestions.length > 0) {
        ta.setAttribute(
          'aria-activedescendant',
          quickDispatchOptionId(LISTBOX_ID, Math.min(activeIndex, suggestions.length - 1)),
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
  }, [token, suggestions.length, activeIndex]);

  const pickSuggestion = useCallback(
    (item: QuickDispatchSuggestion) => {
      if (token?.kind === 'project') {
        const project = filteredProjects.find((p) => p.id === item.id);
        if (!project) return;
        setValue((v) => stripActiveToken(v));
        // A different @project invalidates the skill chip — skills are listed
        // per project and another repo may not have this one installed.
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
    // Skill chips are project-scoped, so they cannot outlive the project chip.
    setProjectChip(null);
    setSkillChip(null);
  }, []);

  // Typeahead navigation + chip editing, intercepted in the CAPTURE phase so
  // it runs before ChatInputBar's own Enter-submits handler and before the
  // card-level Escape-closes handler.
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
          // While a typeahead token is open, Enter picks — it never dispatches
          // a draft that still ends in a half-typed `@`/`/` token.
          e.preventDefault();
          e.stopPropagation();
          const pick = suggestions[Math.min(activeIndex, suggestions.length - 1)];
          if (pick) pickSuggestion(pick);
          return;
        }
        if (e.key === 'Escape') {
          // First Escape dismisses the typeahead (by stripping its token);
          // the card-level handler keeps closing the overlay on the next one.
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
        // AGREED COMPROMISE: the quick-dispatch door
        // (`companion_dispatch_fleet_plan`) is PTY-interactive only — it has no
        // headless mode. Background dispatches therefore fall back to the fleet
        // headless lane (`fleet_spawn_headless_session`) with the prompt
        // composed like `skillCommand()` (`/skill objective`). These sessions
        // SKIP the Athena-owned operation / notify lane — the caption under the
        // toggle says so in the UI.
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
        // Keep an address for the session we just started (agent-dispatch
        // golden path): a key recomputable from the entity ids, stamped into
        // the session name so the Fleet grid and the recent list can find it.
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
      // The registry-changed event refreshes too, but only if the listeners
      // were already live — refresh explicitly so the recent list shows the
      // new session right away.
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
    // Same deep-link the fleet footer icon uses for "open the Fleet page".
    setSidebarSection('plugins');
    setPluginTab('dev-tools');
    setDevToolsTab('fleet');
    closeQuickDispatch();
  }, [setSidebarSection, setPluginTab, setDevToolsTab, closeQuickDispatch]);

  // Quick-dispatched sessions are recognizable by the door's naming: every
  // session it spawns is renamed with the shared `athena` sentinel prefix
  // (ATHENA_SESSION_NAME_SENTINEL → "athena-<role> · <project>"). When none
  // exist yet, fall back to the most recent fleet sessions of any origin.
  const recent = useMemo(() => {
    const athenaOwned = sessions.filter((s) => s.name?.startsWith('athena'));
    const pool = athenaOwned.length > 0 ? athenaOwned : sessions;
    return [...pool]
      .sort((a, b) => Number(b.createdAtMs) - Number(a.createdAtMs))
      .slice(0, 6);
  }, [sessions]);

  if (!open) return null;

  const translatedError =
    rawError == null
      ? null
      : resolveErrorTranslated(t, typeof rawError === 'string' ? rawError : String(rawError));

  // Studio's stateShadow idiom (StudioChatInput): a blue inner glow on the
  // input pill while a dispatch is in flight, plain otherwise.
  const stateShadow = sending
    ? 'inset 0 0 0 1px rgba(96,165,250,0.50), inset 0 1px 14px rgba(96,165,250,0.18), 0 8px 24px -8px rgba(0,0,0,0.45)'
    : undefined;

  const controlChipClass = (setValue_: string | null) =>
    `px-2 py-0.5 rounded-full border typo-caption transition-colors ${
      setValue_
        ? 'bg-primary/10 border-primary/20 text-primary'
        : 'border-foreground/10 text-foreground hover:bg-secondary/60'
    }`;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      data-testid="quick-dispatch-overlay"
    >
      <div
        className="animate-fade-slide-in absolute inset-0 bg-black/50 backdrop-blur-md"
        onClick={closeQuickDispatch}
        aria-label={quickT.close}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={quickT.title}
        className="animate-fade-slide-in relative w-full max-w-lg glass-md rounded-modal shadow-elevation-4 p-3"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeQuickDispatch();
          }
        }}
      >
        {/* Recent dispatches — a settled list, never a spinner (loading shows
            nothing under the permanent card chrome; empty shows a caption
            only once the snapshot settles). */}
        {recent.length > 0 ? (
          <div className="mb-2">
            <div className="px-1 pb-1 typo-caption text-primary">
              {quickT.recent_title}
            </div>
            <ul className="flex flex-col" data-testid="quick-dispatch-recent-list">
              {recent.map((s) => {
                const meta = FLEET_STATE_META.find((m) => m.id === s.state);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={openFleetPage}
                      aria-label={quickT.recent_open_aria}
                      className="w-full flex items-center gap-2 px-1.5 py-1 rounded-interactive hover:bg-foreground/[0.04] transition-colors text-left"
                      data-testid="quick-dispatch-recent-row"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta?.dot ?? 'bg-zinc-500'}`}
                        aria-hidden="true"
                      />
                      <span className="typo-caption text-foreground truncate">
                        {s.title ?? s.name ?? s.projectLabel}
                      </span>
                      <RelativeTime
                        timestamp={Number(s.lastActivityMs)}
                        showTooltip={false}
                        className="ml-auto shrink-0 typo-caption text-foreground"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 mb-2 border-t border-foreground/10" />
          </div>
        ) : !fleetSessionsLoading ? (
          <p className="px-1 pb-2 typo-caption text-foreground" data-testid="quick-dispatch-recent-empty">
            {quickT.recent_empty}
          </p>
        ) : null}

        <div onKeyDownCapture={onComposerKeyDownCapture}>
          {(projectChip || skillChip) && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1" data-testid="quick-dispatch-chips">
              {projectChip && (
                <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 typo-caption rounded-full border bg-primary/10 border-primary/20 text-primary">
                  <Folder className="w-3 h-3" aria-hidden="true" />
                  {projectChip.name}
                  <button
                    type="button"
                    onClick={removeProjectChip}
                    aria-label={tx(quickT.chip_remove, { label: projectChip.name })}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-foreground/10 transition-colors"
                  >
                    <X className="w-2.5 h-2.5" aria-hidden="true" />
                  </button>
                </span>
              )}
              {skillChip && (
                <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 typo-caption rounded-full border bg-violet-500/10 border-violet-500/20 text-violet-300">
                  <Wand2 className="w-3 h-3" aria-hidden="true" />
                  {`/${skillChip.name}`}
                  <button
                    type="button"
                    onClick={removeSkillChip}
                    aria-label={tx(quickT.chip_remove, { label: skillChip.name })}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-foreground/10 transition-colors"
                  >
                    <X className="w-2.5 h-2.5" aria-hidden="true" />
                  </button>
                </span>
              )}
            </div>
          )}

          {token && (suggestions.length > 0 || suggestionHint) && (
            <div className="mb-1.5">
              <QuickDispatchSuggestions
                listboxId={LISTBOX_ID}
                items={suggestions}
                activeIndex={activeIndex}
                hint={suggestionHint}
                onPick={pickSuggestion}
                onHoverIndex={setActiveIndex}
              />
            </div>
          )}

          <ChatInputBar
            value={value}
            onChange={setValue}
            onSubmit={() => {
              if (canSend) void handleSubmit();
            }}
            multiline
            busy={sending}
            disabled={sending}
            boxShadow={stateShadow}
            placeholder={quickT.placeholder}
            sendAriaLabel={quickT.send}
            inputTestId="quick-dispatch-input"
            sendTestId="quick-dispatch-send"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setModel((m) => cycleNext(MODEL_PRESETS, m))}
            className={controlChipClass(model)}
            data-testid="quick-dispatch-model-chip"
          >
            {model ? tx(quickT.model_chip, { model }) : quickT.model_chip_unset}
          </button>
          <button
            type="button"
            onClick={() => setEffort((e) => cycleNext(EFFORT_PRESETS, e))}
            className={controlChipClass(effort)}
            data-testid="quick-dispatch-effort-chip"
          >
            {effort ? tx(quickT.effort_chip, { effort }) : quickT.effort_chip_unset}
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="typo-caption text-foreground">{quickT.headless_label}</span>
            <AccessibleToggle
              checked={headless}
              onChange={() => setHeadless((v) => !v)}
              label={quickT.headless_label}
              size="sm"
              data-testid="quick-dispatch-headless-toggle"
            />
          </div>
        </div>

        {headless && (
          <p className="mt-1 typo-caption text-foreground" data-testid="quick-dispatch-headless-caption">
            {quickT.headless_caption}
          </p>
        )}

        {!headless && !translatedError && !justDispatched && (
          <p className="mt-1 typo-caption text-foreground">{quickT.syntax_hint}</p>
        )}

        {/* Permanently mounted live region (screen-reader-announcements golden
            path): a region that only exists once it has a message is one nothing
            can ever observe changing — swap the text, never the element. */}
        <p
          className={justDispatched ? 'mt-1 typo-caption text-emerald-300' : 'sr-only'}
          role="status"
          data-testid="quick-dispatch-success"
        >
          {justDispatched ? quickT.dispatched : ''}
        </p>

        {translatedError && (
          <p
            className="mt-1 typo-caption text-red-400"
            role="alert"
            data-testid="quick-dispatch-error"
          >
            {translatedError.message} {translatedError.suggestion}
          </p>
        )}
      </div>
    </div>
  );
}
