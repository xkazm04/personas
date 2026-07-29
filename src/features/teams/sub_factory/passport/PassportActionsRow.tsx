// The per-project ACTIONS row — lives on the Compare table's "Stack" group
// header line (first group, always visible), replacing the cramped icon strip
// the cover title row used to carry. Six actions per project column:
// Onboard (guided Fleet session) · Populate project data (contexts / features /
// KPIs) · Standards scan & fixes · Copy readiness report · Rescan project
// (scoped — spares the full-fleet pass) · Improve plan (scoped). EVERY action
// introduces itself before running — the user always knows what a click does in
// advance. The gate is a full ActionConfirmModal (steps + boundaries + facts),
// not the old one-paragraph popover; its copy lives in actionConfirmCatalog
// next to the flows it describes.
//
// Onboard and Populate are deliberately different shapes. Onboarding decides
// what a project SHOULD have and runs one way (Fleet). Populate fills in what
// the app needs to work with the project at all, and offers a transport choice
// because its KPI phase is a long negotiation the operator may want in their
// own terminal, outliving the app.
import { useMemo, useState } from 'react';
import { TerminalSquare } from 'lucide-react';

import { installSystemSkill } from '@/api/devTools/devTools';
import { writeDispatchBrief } from '@/api/fleet/fleet';
import { listCredentials } from '@/api/vault/credentials';
import { DispatchChooserModal, type DispatchRequest } from '@/features/shared/dispatch/DispatchChooser';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';

import type { AppPassport } from './passportModel';
import { INK } from './passportInk';
import { ActionConfirmModal } from './ActionConfirmModal';
import { buildActionSpecs } from './actionConfirmCatalog';
import { useImprove } from './improve/ImproveContext';
import { FindingsPopover } from './improve/StandardsScan';
import { seedOnboardingMilestone } from '../l2/ship/seedOnboarding';
import { buildOnboardPrompt, onboardDispatchKey } from './onboardDispatch';
import { PopulateScopePicker } from './PopulateScopePicker';
import {
  buildPopulateBrief,
  buildPopulatePrompt,
  defaultLanes,
  describeGates,
  populateDispatchKey,
  readPopulateGates,
  POPULATE_BRIEF_PATH,
  type PopulateGates,
  type PopulateLane,
} from './populateDispatch';
import { PASSPORT_FLEET_INK } from './passportFleet';
import { dispatchSkillToRepo } from './skillPlacement';
import { passportToMarkdown } from './passportExport';

export function PassportActionsCell({ p, onboardSession, onOpenOnboardTerminal, rescanning, onRescanProject, onOpenPlan }: {
  p: AppPassport;
  /** Live `passport:onboard:<slug>` session, if one runs. */
  onboardSession: FleetSession | null;
  onOpenOnboardTerminal: () => void;
  /** True while THIS project's scoped rescan runs. */
  rescanning: boolean;
  onRescanProject: () => void;
  onOpenPlan: () => void;
}) {
  const improve = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const { copy } = useCopyToClipboard();
  const [confirm, setConfirm] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [findingsAnchor, setFindingsAnchor] = useState<DOMRect | null>(null);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [gates, setGates] = useState<PopulateGates | null>(null);
  const [lanes, setLanes] = useState<PopulateLane[] | null>(null);
  const [populateRequest, setPopulateRequest] = useState<DispatchRequest | null>(null);

  const slug = p.identity.slug;
  const raw = improve?.getRaw(slug);
  const name = p.identity.name;

  const dispatchOnboard = () => {
    if (!raw || onboardBusy) return;
    setOnboardBusy(true);
    listCredentials()
      // Place the canonical passport-onboard skill into the target repo first
      // (from the global library) so /passport-onboard resolves there, then run.
      .then((creds) => dispatchSkillToRepo({
        skillName: 'passport-onboard',
        system: true,
        targetProjectId: raw.project.id,
        targetRoot: raw.project.root_path,
        dispatchKey: onboardDispatchKey(slug),
        prompt: buildOnboardPrompt(p, raw, creds),
      }))
      .then(() => {
        setOnboardBusy(false);
        // Ship layer: a fresh project's first milestone IS the onboarding —
        // seed it (idempotent) so the Ship tab opens with a live deliverable.
        void seedOnboardingMilestone(raw.project.id).catch(silentCatch('passport onboard milestone seed'));
      })
      .catch((e) => { setOnboardBusy(false); toastCatch('passport onboard dispatch')(e); });
  };

  // Populate hands the user a transport choice rather than spawning outright,
  // so the work here stops at composing the request. Everything the repo needs
  // (the skill, the briefing) happens in `prepare`, which the chooser runs
  // after the user commits to a method — so backing out of the chooser leaves
  // the repo untouched.
  // Read the lane verdicts as soon as the consent modal opens, so its steps can
  // say what THIS run would actually do ("context map: 3 months old, will
  // re-scan incrementally") instead of describing the action in the abstract.
  const loadGates = () => {
    if (!raw || gates) return;
    void readPopulateGates(raw.project.id)
      .then((fresh) => {
        setGates(fresh);
        // Seed the lane selection from the gates, so the modal opens on the
        // work this project actually needs.
        setLanes((current) => current ?? defaultLanes(fresh));
      })
      .catch(silentCatch('passport populate gates'));
  };

  const openPopulateChooser = () => {
    if (!raw) return;
    void Promise.all([gates ? Promise.resolve(gates) : readPopulateGates(raw.project.id), listCredentials()])
      .then(([fresh, creds]) => {
        setGates(fresh);
        const picked = lanes ?? defaultLanes(fresh);
        const brief = buildPopulateBrief(p, raw, creds, fresh, picked);
        setPopulateRequest({
          title: `Populate ${name}'s project data`,
          prompt: buildPopulatePrompt(picked),
          target: { projectId: raw.project.id, projectName: name, rootPath: raw.project.root_path },
          fleetKey: populateDispatchKey(slug),
          methods: ['fleet', 'console'],
          consoleSkipPermissions: true,
          prepare: async () => {
            await installSystemSkill('project-populate', raw.project.id, true);
            await writeDispatchBrief(raw.project.root_path, POPULATE_BRIEF_PATH, brief);
          },
        });
      })
      .catch(toastCatch('passport populate'));
  };

  // Per-action behaviour, joined onto the catalog's copy by id. The catalog owns
  // WHAT the user is told; this owns what the confirm actually calls.
  const behaviour: Record<string, { run: (anchor: DOMRect) => void; disabled?: boolean }> = {
    onboard: { run: dispatchOnboard, disabled: !raw || onboardBusy },
    populate: { run: openPopulateChooser, disabled: !raw },
    standards: { run: (anchor) => setFindingsAnchor(anchor), disabled: !raw },
    copy: { run: () => { copy(passportToMarkdown(p, Date.now())); addToast('Readiness report copied', 'success'); } },
    rescan: { run: onRescanProject, disabled: rescanning },
    plan: { run: onOpenPlan },
  };
  const specs = useMemo(
    () => buildActionSpecs(name, raw?.project.root_path, gates ? describeGates(gates) : undefined),
    [name, raw?.project.root_path, gates],
  );
  const ACTIONS = specs.map((s) => ({ ...s, ...behaviour[s.id] }));

  return (
    <span className="inline-flex items-center gap-0.5" data-testid={`passport-actions-${slug}`}>
      {onboardSession ? (
        <button
          type="button"
          onClick={onOpenOnboardTerminal}
          title="Onboarding session live, open terminal"
          className="p-1 rounded-interactive transition-colors hover:bg-primary/10 focus-ring"
          style={{ color: PASSPORT_FLEET_INK[String(onboardSession.state)] ?? INK.violet }}
          data-testid={`passport-actions-onboard-live-${slug}`}
        >
          <TerminalSquare className={`w-5 h-5 ${onboardSession.state === 'running' || onboardSession.state === 'spawning' ? 'animate-pulse' : ''}`} aria-hidden />
        </button>
      ) : null}
      {ACTIONS.filter((a) => !(a.id === 'onboard' && onboardSession)).map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.id}
            type="button"
            disabled={a.disabled}
            onClick={(e) => {
              // Read the rect NOW — e.currentTarget is detached by the time a
              // state-updater callback runs.
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              if (a.id === 'populate') loadGates();
              setConfirm((c) => (c?.id === a.id ? null : { id: a.id, anchor: rect }));
            }}
            title={a.tooltip}
            className={`p-1 rounded-interactive text-foreground/45 hover:text-primary hover:bg-primary/[0.06] disabled:opacity-40 transition-colors focus-ring ${a.id === 'rescan' && rescanning ? 'animate-spin' : ''}`}
            data-testid={`passport-action-${a.id}-${slug}`}
          >
            <Icon className="w-5 h-5" aria-hidden />
          </button>
        );
      })}
      {confirm && (() => {
        const spec = ACTIONS.find((a) => a.id === confirm.id);
        if (!spec) return null;
        const scopePicker =
          confirm.id === 'populate' && gates ? (
            <PopulateScopePicker
              gates={gates}
              lanes={lanes ?? defaultLanes(gates)}
              onChange={setLanes}
            />
          ) : undefined;
        return (
          <ActionConfirmModal
            spec={spec}
            extra={scopePicker}
            confirmDisabled={scopePicker != null && (lanes ?? []).length === 0}
            onConfirm={() => spec.run?.(confirm.anchor)}
            onClose={() => setConfirm(null)}
          />
        );
      })()}
      {findingsAnchor && (
        <FindingsPopover slug={slug} projectName={name} anchor={findingsAnchor} onClose={() => setFindingsAnchor(null)} />
      )}
      {populateRequest && (
        <DispatchChooserModal
          request={populateRequest}
          onClose={() => setPopulateRequest(null)}
          onDispatched={(method) => {
            addToast(
              method === 'console'
                ? `Populating ${name} in a new terminal window`
                : `Populating ${name} in a Fleet session`,
              'success',
            );
            // The run rewrites the lanes it touches, so the cached verdicts are
            // stale the moment it starts.
            setGates(null);
          }}
        />
      )}
    </span>
  );
}
