// The per-project ACTIONS row — lives on the Compare table's "Stack" group
// header line (first group, always visible), replacing the cramped icon strip
// the cover title row used to carry. Five actions per project column:
// Onboard (guided Fleet session) · Standards scan & fixes · Copy readiness
// report · Rescan project (scoped — spares the full-fleet pass) · Improve plan
// (scoped). EVERY action introduces itself in a consent popover before running
// — the user always knows what a click does in advance.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Compass, FileDown, RefreshCw, ShieldCheck, Target, TerminalSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { listCredentials } from '@/api/vault/credentials';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';

import type { AppPassport } from './passportModel';
import { INK, anchorTip } from './passportInk';
import { useImprove } from './improve/ImproveContext';
import { FindingsPopover } from './improve/StandardsScan';
import { buildOnboardPrompt, onboardDispatchKey } from './onboardDispatch';
import { dispatchRowToFleet, PASSPORT_FLEET_INK } from './passportFleet';
import { passportToMarkdown } from './passportExport';

const CONFIRM_WIDTH = 296;

/** The consent gate — anchored popover introducing an action before it runs
 *  (the pattern the old header Rescan established, generalized). */
function ActionConfirmPopover({ anchor, title, description, confirmLabel, onConfirm, onClose }: {
  anchor: DOMRect;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const pos = anchorTip(anchor, CONFIRM_WIDTH, 170);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      style={{ top: pos.top, left: pos.left, width: CONFIRM_WIDTH }}
      className="fixed z-[9995] rounded-modal border border-primary/15 bg-background shadow-elevation-4 px-3 py-2.5"
      data-testid="passport-action-confirm"
    >
      <span className="typo-caption font-semibold text-foreground block mb-1">{title}</span>
      <p className="typo-caption text-foreground/60 leading-snug mb-2.5" style={{ fontWeight: 400 }}>{description}</p>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1 rounded-interactive typo-caption font-medium text-foreground hover:bg-secondary/40 border border-primary/10 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => { onClose(); onConfirm(); }}
          className="px-2.5 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors"
          data-testid="passport-action-confirm-yes"
        >
          {confirmLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}

interface ActionSpec {
  id: string;
  icon: LucideIcon;
  tooltip: string;
  title: string;
  description: string;
  confirmLabel: string;
}

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
      .then((creds) => dispatchRowToFleet(onboardDispatchKey(slug), raw.project.root_path, buildOnboardPrompt(p, raw, creds)))
      .then(() => setOnboardBusy(false))
      .catch((e) => { setOnboardBusy(false); toastCatch('passport onboard dispatch')(e); });
  };

  const ACTIONS: Array<ActionSpec & { run: (anchor: DOMRect) => void; disabled?: boolean }> = [
    {
      id: 'onboard',
      icon: Compass,
      tooltip: 'Onboard with Fleet',
      title: `Onboard ${name}?`,
      description: 'Spawns a Fleet terminal in the project repo running the guided onboarding skill — it assesses every passport dimension, offers you select choices in the terminal, and executes only what you accept. Nothing runs without your answers.',
      confirmLabel: 'Start session',
      run: dispatchOnboard,
      disabled: !raw || onboardBusy,
    },
    {
      id: 'standards',
      icon: ShieldCheck,
      tooltip: 'Standards scan & fixes',
      title: 'Standards scan & fixes?',
      description: 'Runs the golden-standard scan over this project and lists each open finding with a one-click fix — instant config toggles where they map, "Fix with Claude" tasks otherwise. The scan reads; fixes only apply when you click them.',
      confirmLabel: 'Open scan',
      run: (anchor) => setFindingsAnchor(anchor),
      disabled: !raw,
    },
    {
      id: 'copy',
      icon: FileDown,
      tooltip: 'Copy readiness report',
      title: 'Copy readiness report?',
      description: 'Copies a markdown readiness report for this project — levels, scores and blockers, public-safe (no credentials, costs or local paths). Paste it into a README, PR or issue. Nothing leaves your machine.',
      confirmLabel: 'Copy',
      run: () => { copy(passportToMarkdown(p, Date.now())); addToast('Readiness report copied', 'success'); },
    },
    {
      id: 'rescan',
      icon: RefreshCw,
      tooltip: 'Rescan this project',
      title: `Rescan ${name}?`,
      description: 'Re-aggregates ONLY this project’s metadata and re-derives its passport — the other projects carry over from the last scan, sparing the full cross-project pass. Read-only: nothing in the repo is modified.',
      confirmLabel: 'Rescan',
      run: onRescanProject,
      disabled: rescanning,
    },
    {
      id: 'plan',
      icon: Target,
      tooltip: 'Improve plan (this project)',
      title: `Improve plan for ${name}?`,
      description: 'Builds a focused improvement plan for this project only — every below-target gap ranked by impact-per-effort, with batch-queueable Claude tasks. Queued tasks wait for review; nothing runs on open.',
      confirmLabel: 'Build plan',
      run: onOpenPlan,
    },
  ];

  return (
    <span className="inline-flex items-center gap-0.5" data-testid={`passport-actions-${slug}`}>
      {onboardSession ? (
        <button
          type="button"
          onClick={onOpenOnboardTerminal}
          title="Onboarding session live — open terminal"
          className="p-1 rounded-interactive transition-colors hover:bg-primary/10 focus-ring"
          style={{ color: PASSPORT_FLEET_INK[String(onboardSession.state)] ?? INK.violet }}
          data-testid={`passport-actions-onboard-live-${slug}`}
        >
          <TerminalSquare className={`w-3.5 h-3.5 ${onboardSession.state === 'running' || onboardSession.state === 'spawning' ? 'animate-pulse' : ''}`} aria-hidden />
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
            <Icon className="w-3.5 h-3.5" aria-hidden />
          </button>
        );
      })}
      {confirm && (() => {
        const spec = ACTIONS.find((a) => a.id === confirm.id);
        if (!spec) return null;
        return (
          <ActionConfirmPopover
            anchor={confirm.anchor}
            title={spec.title}
            description={spec.description}
            confirmLabel={spec.confirmLabel}
            onConfirm={() => spec.run(confirm.anchor)}
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
