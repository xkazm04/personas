// R19 — the unified SETUP MODAL for the Evals / Security / Tests / Migrations
// rows: reachable from the cell's setup icon at ANY level (not just red), it
// offers THREE DIRECTIONS to go with:
//   • scan-derived directions first — `applicableDeployActions` carries the
//     gap-aware actions the passport scan actually found (badged "from scan");
//   • generic app directions fill the remaining slots (Scan X / Harden Y /
//     Gate Z per row) so there are always three ways forward.
// The chosen direction (+ optional custom instructions) dispatches a FLEET
// terminal in the project's repo root — Fleet is the LLM engine here, not the
// Dev Runner. The cell's icon then flips to the state-tinted terminal icon.
import { useMemo, useRef, useState } from 'react';
import { MessagesSquare, Rocket, ScanSearch, ShieldCheck, Sparkles, X } from 'lucide-react';

import { listCredentials } from '@/api/vault/credentials';
import { BaseModal } from '@/features/shared/components/modals';
import { toastCatch } from '@/lib/silentCatch';

import type { AppPassport } from './passportModel';
import { INK } from './passportInk';
import { applicableDeployActions } from './improve/deployActions';
import { useImprove } from './improve/ImproveContext';
import { buildDimensionOnboardPrompt } from './onboardDispatch';
import { dispatchRowToFleet, passportDispatchKey } from './passportFleet';
import { ROW_DIRECTIONS, buildDirectionPrompt } from './rowDirections';

interface Direction {
  id: string;
  label: string;
  hint: string;
  fromScan: boolean;
  buildPrompt: (projectName: string) => string;
}

const ROW_ICON: Record<string, typeof ShieldCheck> = {
  tests: ScanSearch, security: ShieldCheck, evals: Sparkles, migrations: ScanSearch,
};

/** Row key → the passport-onboard skill's dimension label (guided sessions). */
const ROW_DIMENSION: Record<string, string> = {
  evals: 'Evals',
  security: 'Security',
  tests: 'Tests',
  migrations: 'Database & migrations',
};

const GUIDED_ID = '__guided__';

export function RowSetupModal({ rowKey, rowLabel, passport, currentLabel, onDispatched, onClose }: {
  rowKey: string;
  rowLabel: string;
  passport: AppPassport;
  /** The row's current level label — the modal's state line. */
  currentLabel: string;
  onDispatched: () => void;
  onClose: () => void;
}) {
  const engine = useImprove();
  const [selected, setSelected] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const instructionRef = useRef(instruction);
  instructionRef.current = instruction;
  const [busy, setBusy] = useState(false);

  const slug = passport.identity.slug;
  const raw = engine?.getRaw(slug);

  // Three directions: scan-derived first (the passport scan's gap-aware
  // actions), generic app prompts fill the rest.
  const directions = useMemo<Direction[]>(() => {
    const scanActs: Direction[] = applicableDeployActions(rowKey, passport)
      .filter((a) => a.kind === 'task' && a.prompt)
      .slice(0, 3)
      .map((a) => ({
        id: a.id,
        label: a.label,
        hint: a.hint,
        fromScan: true,
        buildPrompt: () => (raw ? a.prompt!(raw.project, passport) : a.hint),
      }));
    const generics: Direction[] = (ROW_DIRECTIONS[rowKey] ?? []).map((g) => ({
      id: g.id,
      label: g.label,
      hint: g.hint,
      fromScan: false,
      buildPrompt: (projectName: string) => buildDirectionPrompt({ projectName, direction: g, instruction: instructionRef.current }),
    }));
    return [...scanActs, ...generics.filter((g) => !scanActs.some((s) => s.label === g.label))].slice(0, 3);
  }, [rowKey, passport, raw]);

  const dispatch = (prompt: string) => {
    if (!raw) return;
    dispatchRowToFleet(passportDispatchKey(rowKey, slug), raw.project.root_path, prompt)
      .then(() => { setBusy(false); onDispatched(); onClose(); })
      .catch((e) => { setBusy(false); toastCatch('passport fleet deploy')(e); });
  };

  const deploy = () => {
    if (!raw) return;
    // Guided session — the passport-onboard skill scoped to this dimension:
    // the terminal runs the skill's select rounds and WAITS for the operator.
    if (selected === GUIDED_ID) {
      setBusy(true);
      listCredentials()
        .then((creds) => dispatch(buildDimensionOnboardPrompt(
          passport, raw, creds,
          { key: rowKey, label: ROW_DIMENSION[rowKey] ?? rowLabel },
          instruction,
        )))
        .catch((e) => { setBusy(false); toastCatch('passport fleet deploy')(e); });
      return;
    }
    const dir = directions.find((d) => d.id === selected);
    if (!dir) return;
    setBusy(true);
    // Generic directions come fully framed by buildDirectionPrompt; scan-derived
    // prompts get the same instruction + working contract appended here.
    const base = dir.buildPrompt(raw.project.name);
    const prompt = dir.fromScan
      ? base +
        (instruction.trim() ? ` Additional instructions from the operator: ${instruction.trim()}.` : '') +
        ' Work in this repository, commit atomically with clear messages, and finish with a short report: what changed, what you verified, what remains.'
      : base;
    dispatch(prompt);
  };

  const Icon = ROW_ICON[rowKey] ?? Sparkles;

  return (
    <BaseModal isOpen onClose={onClose} titleId="row-setup-title" portal maxWidthClass="max-w-2xl" staggerChildren={false}>
      <div data-testid="row-setup-modal">
        <div className="flex items-start gap-2.5 pb-2 border-b border-primary/10">
          <Icon className="w-5 h-5 mt-0.5 shrink-0" style={{ color: INK.teal }} aria-hidden />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em] text-foreground/40">{passport.identity.name}</div>
            <h2 id="row-setup-title" className="typo-body font-semibold text-foreground">{rowLabel}</h2>
            <p className="typo-caption text-foreground/55 mt-0.5">
              Currently at “{currentLabel}” — pick a direction; a Fleet terminal runs it in the project’s repo.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto shrink-0 p-1 rounded-interactive text-foreground/50 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring">
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>

        <div className="grid gap-2 mt-3" data-testid="row-setup-directions">
          {(() => {
            const on = selected === GUIDED_ID;
            return (
              <button
                type="button"
                onClick={() => setSelected(on ? null : GUIDED_ID)}
                className="text-left rounded-card px-3 py-2.5 transition-colors focus-ring"
                style={{
                  border: `1px solid ${on ? INK.violet : `${INK.violet}44`}`,
                  background: on ? `${INK.violet}0d` : `${INK.violet}06`,
                }}
                data-testid="direction-guided"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <MessagesSquare className="w-3.5 h-3.5 shrink-0" style={{ color: INK.violet }} aria-hidden />
                  <span className="typo-caption font-semibold text-foreground truncate">Guided session</span>
                  <span className="shrink-0 rounded-full px-1.5 py-[1px] text-[9px] font-medium tracking-wide" style={{ color: INK.violet, border: `1px solid ${INK.violet}55`, background: `${INK.violet}14` }}>
                    interactive
                  </span>
                </span>
                <span className="block typo-caption text-foreground/55 mt-0.5 pl-[22px]">
                  The onboarding skill scoped to this dimension — it assesses, offers you select choices in the terminal, and executes what you accept.
                </span>
              </button>
            );
          })()}
          {directions.map((d) => {
            const on = selected === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelected(on ? null : d.id)}
                className="text-left rounded-card px-3 py-2.5 transition-colors focus-ring"
                style={{
                  border: `1px solid ${on ? INK.teal : 'rgba(148,163,184,.18)'}`,
                  background: on ? `${INK.teal}0d` : 'rgba(148,163,184,.03)',
                }}
                data-testid={`direction-${d.id}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={on ? { background: INK.teal, boxShadow: `0 0 5px ${INK.teal}88` } : { border: '1px solid rgba(148,163,184,.45)' }} />
                  <span className="typo-caption font-semibold text-foreground truncate">{d.label}</span>
                  {d.fromScan && (
                    <span className="shrink-0 rounded-full px-1.5 py-[1px] text-[9px] font-medium tracking-wide" style={{ color: INK.violet, border: `1px solid ${INK.violet}55`, background: `${INK.violet}14` }}>
                      from scan
                    </span>
                  )}
                </span>
                <span className="block typo-caption text-foreground/55 mt-0.5 pl-4">{d.hint}</span>
              </button>
            );
          })}
        </div>

        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={2}
          placeholder="Additional instructions for the run…"
          className="w-full bg-transparent border rounded-input px-2.5 py-1.5 typo-caption text-foreground focus-ring resize-none mt-3"
          style={{ borderColor: 'rgba(148,163,184,.25)' }}
          data-testid="row-setup-instruction"
        />

        <button
          type="button"
          disabled={busy || !selected || !raw}
          onClick={deploy}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-card px-3 py-2 typo-caption font-semibold transition-colors focus-ring hover:bg-foreground/[0.05] disabled:opacity-40"
          style={{ color: INK.teal, border: `1px solid ${INK.teal}55` }}
          data-testid="row-setup-deploy"
        >
          <Rocket className="w-3.5 h-3.5" aria-hidden />
          {busy ? 'Dispatching…' : 'Deploy to Fleet'}
        </button>
        <p className="text-[10px] text-foreground/35 text-center mt-1.5">
          Opens a Fleet terminal in the repo root — the cell icon tracks its state; click it to open the terminal.
        </p>
      </div>
    </BaseModal>
  );
}
