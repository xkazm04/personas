// Universal dispatch chooser — ONE consent surface for handing a prepared
// prompt to an agent, offered over the FOUR transports the app ships:
//
//   • Dev runner  — a queued dev task executed by the engine's runner
//                   (model-routed, tracked in Run Desk; no terminal).
//   • Fleet       — an interactive Claude terminal spawned in the repo root
//                   (watch + steer; named with a dedup key so surfaces can
//                   reopen the session as their terminal door).
//   • Claude CLI  — a headless `claude -p` run (stream-json, resource-light;
//                   state + insights land in the Fleet grid, never an xterm).
//   • Console     — an interactive session in a NEW OS terminal window the
//                   USER owns. The app keeps no handle: it cannot observe,
//                   steer or kill the session, and the window outlives the
//                   app. For work the operator will carry on by hand for many
//                   turns. Windows-only today; callers offer it explicitly.
//
// The popup shows the offered options as icon cards, the prepared prompt stays
// editable, and NOTHING runs until the user confirms one method. Any feature
// can mount this with a DispatchRequest — the Ship layer's goal actions are
// the first consumer; more surfaces are expected to reuse it.
import { useState } from 'react';
import { Bot, Rocket, SquareTerminal, TerminalSquare, Zap } from 'lucide-react';

import { createTask, executeTask } from '@/api/devTools/devTools';
import {
  listSessions,
  renameSession,
  spawnExternalConsole,
  spawnHeadlessSession,
  spawnSession,
} from '@/api/fleet/fleet';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { BaseModal } from '@/features/shared/components/modals';
import { getActiveTranslations } from '@/i18n/useTranslation';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

export type DispatchMethod = 'dev_runner' | 'fleet' | 'cli' | 'console';

export interface DispatchRequest {
  /** Short human title — the modal heading and the dev task's title. */
  title: string;
  /** The prepared prompt/input — shown editable before anything runs. */
  prompt: string;
  target: { projectId: string; projectName: string; rootPath: string };
  /** Fleet session name (dedup + terminal-door). Also stamps the CLI run. */
  fleetKey?: string;
  /** Restrict the offered methods (default: the three app-managed ones —
   *  `console` is opt-in because the app cannot manage what it spawns). */
  methods?: DispatchMethod[];
  /** Runs once the user confirms, BEFORE the chosen transport. For work that
   *  makes the repo ready for the dispatch regardless of transport — placing a
   *  skill, writing a briefing the prompt points at. Throwing aborts the
   *  dispatch with the error surfaced, so a half-prepared repo never gets a
   *  session pointed at it. */
  prepare?: () => Promise<void>;
  /** Pass `--dangerously-skip-permissions` on the `console` transport. Fleet
   *  always does (its sessions are unattended); a console has the operator in
   *  front of it but sits outside the app's kill switch, so it is a per-caller
   *  decision. Ignored by every other method. */
  consoleSkipPermissions?: boolean;
}

const METHOD_ICON: Record<DispatchMethod, typeof Bot> = {
  dev_runner: Bot,
  fleet: SquareTerminal,
  cli: Zap,
  console: TerminalSquare,
};

const ALL_METHODS: DispatchMethod[] = ['dev_runner', 'fleet', 'cli'];

export function DispatchChooserModal({ request, onClose, onDispatched }: {
  request: DispatchRequest;
  onClose: () => void;
  /** Fired after the chosen transport accepted the work. `ref` is the task id
   *  (dev_runner) or session id (fleet/cli). */
  onDispatched?: (method: DispatchMethod, ref: string) => void;
}) {
  const { t, tx } = useTranslation();
  const methods = request.methods ?? ALL_METHODS;
  const methodMeta: Record<DispatchMethod, { label: string; desc: string }> = {
    dev_runner: { label: t.common.dispatch_method_dev_runner, desc: t.common.dispatch_method_dev_runner_desc },
    fleet: { label: t.common.dispatch_method_fleet, desc: t.common.dispatch_method_fleet_desc },
    cli: { label: t.common.dispatch_method_cli, desc: t.common.dispatch_method_cli_desc },
    console: { label: t.common.dispatch_method_console, desc: t.common.dispatch_method_console_desc },
  };
  const [method, setMethod] = useState<DispatchMethod>(methods.includes('fleet') ? 'fleet' : methods[0] ?? 'fleet');
  const [prompt, setPrompt] = useState(request.prompt);
  const [busy, setBusy] = useState(false);
  const fleetKey = request.fleetKey ?? `dispatch:${request.target.projectId}:${request.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;

  const dispatch = async () => {
    setBusy(true);
    try {
      await request.prepare?.();
      let ref: string;
      if (method === 'dev_runner') {
        const task = await createTask(request.title, request.target.projectId, prompt);
        await executeTask(task.id);
        ref = task.id;
      } else if (method === 'fleet') {
        const snap = await listSessions();
        const running = snap.sessions.find((s) => s.name === fleetKey && s.state !== 'exited');
        if (running) throw new Error(getActiveTranslations().common.dispatch_already_running);
        ref = await spawnSession(request.target.rootPath, [prompt]);
        await renameSession(ref, fleetKey);
      } else if (method === 'console') {
        // No dedup check: the app holds no handle on these windows, so it
        // cannot know whether an earlier one is still open. The operator can
        // see their own terminals.
        const pid = await spawnExternalConsole({
          cwd: request.target.rootPath,
          prompt,
          skipPermissions: request.consoleSkipPermissions,
        });
        ref = String(pid);
      } else {
        ref = await spawnHeadlessSession(request.target.rootPath, prompt);
        await renameSession(ref, `${fleetKey}:cli`);
      }
      onDispatched?.(method, ref);
      onClose();
    } catch (e) {
      toastCatch('dispatch chooser')(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="dispatch-chooser-title" portal maxWidthClass="max-w-2xl" staggerChildren={false}>
      <div data-testid="dispatch-chooser">
        <h2 id="dispatch-chooser-title" className="typo-title-lg mb-0.5">{request.title}</h2>
        <p className="typo-caption mb-3">{tx(t.common.dispatch_pick_method, { project: request.target.projectName })}</p>

        {/* the three transports */}
        <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: `repeat(${methods.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={t.common.dispatch_method_aria}>
          {methods.map((m) => {
            const meta = methodMeta[m];
            const Icon = METHOD_ICON[m];
            const on = method === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMethod(m)}
                className={`rounded-card border px-3 py-2.5 text-left transition-colors focus-ring ${on ? 'border-primary/50 bg-primary/[0.07]' : 'border-foreground/[0.1] hover:bg-foreground/[0.03]'}`}
                data-testid={`dispatch-method-${m}`}
              >
                <span className="flex items-center gap-1.5 mb-1">
                  <Icon className={`w-4 h-4 ${on ? 'text-primary' : 'text-foreground/55'}`} aria-hidden />
                  <span className={`typo-caption font-semibold ${on ? 'text-foreground' : 'text-foreground/75'}`}>{meta.label}</span>
                </span>
                <span className="typo-caption block leading-snug text-foreground/55">{meta.desc}</span>
              </button>
            );
          })}
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={9}
          className="w-full rounded-input border border-foreground/[0.12] bg-background/70 px-3 py-2 typo-caption text-foreground/90 outline-none focus:border-primary/40 resize-y"
          data-testid="dispatch-prompt"
        />

        <div className="flex items-center justify-end gap-2 mt-3">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-interactive typo-caption text-foreground/60 hover:text-foreground transition-colors focus-ring">
            {t.common.cancel}
          </button>
          <AsyncButton
            isLoading={busy}
            disabled={prompt.trim().length === 0}
            onClick={() => void dispatch()}
            icon={<Rocket className="w-3.5 h-3.5" aria-hidden />}
            data-testid="dispatch-confirm"
          >
            {t.common.dispatch_action}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
