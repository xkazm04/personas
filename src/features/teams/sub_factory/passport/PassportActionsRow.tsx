// The per-project ACTIONS row — lives on the Compare table's "Stack" group
// header line (first group, always visible), replacing the cramped icon strip
// the cover title row used to carry. Five actions per project column:
// Onboard (guided Fleet session) · Standards scan & fixes · Copy readiness
// report · Rescan project (scoped — spares the full-fleet pass) · Improve plan
// (scoped). EVERY action introduces itself before running — the user always
// knows what a click does in advance. The gate is a full ActionConfirmModal
// (steps + boundaries + facts), not the old one-paragraph popover; its copy
// lives in actionConfirmCatalog next to the flows it describes.
import { useMemo, useState } from 'react';
import { TerminalSquare } from 'lucide-react';

import { listCredentials } from '@/api/vault/credentials';
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

  // Per-action behaviour, joined onto the catalog's copy by id. The catalog owns
  // WHAT the user is told; this owns what the confirm actually calls.
  const behaviour: Record<string, { run: (anchor: DOMRect) => void; disabled?: boolean }> = {
    onboard: { run: dispatchOnboard, disabled: !raw || onboardBusy },
    standards: { run: (anchor) => setFindingsAnchor(anchor), disabled: !raw },
    copy: { run: () => { copy(passportToMarkdown(p, Date.now())); addToast('Readiness report copied', 'success'); } },
    rescan: { run: onRescanProject, disabled: rescanning },
    plan: { run: onOpenPlan },
  };
  const specs = useMemo(
    () => buildActionSpecs(name, raw?.project.root_path),
    [name, raw?.project.root_path],
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
        return (
          <ActionConfirmModal
            spec={spec}
            onConfirm={() => spec.run?.(confirm.anchor)}
            onClose={() => setConfirm(null)}
          />
        );
      })()}
      {findingsAnchor && (
        <FindingsPopover slug={slug} projectName={name} anchor={findingsAnchor} onClose={() => setFindingsAnchor(null)} />
      )}
    </span>
  );
}
