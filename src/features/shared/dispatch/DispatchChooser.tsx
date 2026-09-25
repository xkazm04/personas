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
//
// RUN ON ANOTHER DEVICE. `RunOnSelect` above the cards picks this machine or a
// paired device. On a device, only `fleet` (interactive) and `cli` (headless)
// cross; the runner and the console are disabled with the reason on the card,
// and Confirm sends the session through `dispatchToDevice` instead of spawning
// here. A dispatch whose `prepare` writes files on THIS machine cannot cross
// (the files would not be over there), so its devices are disabled too.
import { useState } from 'react';
import { Rocket } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { BaseModal } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { DispatchMethodCards } from './DispatchMethodCards';
import { runLocalDispatch } from './localDispatch';
import { dispatchToDevice, isRemoteCapable, remoteModeFor, useProjectGitRemote } from './remoteDispatch';
import { RunOnSelect } from './RunOnSelect';

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

const ALL_METHODS: DispatchMethod[] = ['dev_runner', 'fleet', 'cli'];

export function DispatchChooserModal({ request, onClose, onDispatched }: {
  request: DispatchRequest;
  onClose: () => void;
  /** Fired after the chosen transport accepted the work. `ref` is the task id
   *  (dev_runner), the session id (fleet/cli), or the remote job id when the
   *  work went to a paired device. */
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
  // `null` = this machine; otherwise the paired device's peer id.
  const [runOn, setRunOn] = useState<string | null>(null);
  const githubUrl = useProjectGitRemote(request.target.projectId);
  const remote = runOn !== null;
  const localOnly = (m: DispatchMethod) => (remote && !isRemoteCapable(m) ? t.common.dispatch_run_on_local_only : null);
  const pickRunOn = (peerId: string | null) => {
    setRunOn(peerId);
    // A device cannot run the runner or a console: move to one that crosses.
    if (peerId !== null && !isRemoteCapable(method)) setMethod(methods.find(isRemoteCapable) ?? method);
  };
  const fleetKey = request.fleetKey ?? `dispatch:${request.target.projectId}:${request.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;

  const dispatch = async () => {
    setBusy(true);
    try {
      const ref = runOn !== null
        ? (await dispatchToDevice({
            peerId: runOn,
            projectId: request.target.projectId,
            projectName: request.target.projectName,
            githubUrl: githubUrl ?? '',
            prompt,
            mode: remoteModeFor(method),
          })).id
        : await runLocalDispatch(method, request, prompt, fleetKey);
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

        {methods.some(isRemoteCapable) && (
          <div className="mb-3">
            <RunOnSelect
              value={runOn}
              onChange={pickRunOn}
              githubUrl={githubUrl}
              remoteBlockedReason={request.prepare ? t.common.dispatch_run_on_local_prep : null}
            />
          </div>
        )}

        <DispatchMethodCards
          methods={methods}
          value={method}
          onChange={setMethod}
          meta={methodMeta}
          disabledReason={localOnly}
          ariaLabel={t.common.dispatch_method_aria}
        />

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={9}
          className="w-full rounded-input border border-foreground/[0.12] bg-background/70 px-3 py-2 typo-caption text-foreground/90 outline-none focus:border-primary/40 resize-y"
          data-testid="dispatch-prompt"
        />

        <div className="flex items-center justify-end gap-2 mt-3">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-interactive typo-caption text-foreground hover:bg-secondary/40 transition-colors focus-ring">
            {t.common.cancel}
          </button>
          <AsyncButton
            isLoading={busy}
            disabled={prompt.trim().length === 0}
            // `dispatch()` not `void dispatch()`. AsyncButton disarms
            // double-submit by awaiting the promise its onClick returns; `void`
            // discards that promise, so the guard has nothing to await and the
            // button stays live. Replayed statement-for-statement: two presses
            // inside one commit frame produced TWO Fleet sessions; returning the
            // promise holds it at one at every gap.
            onClick={() => dispatch()}
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
