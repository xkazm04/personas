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
import { useMemo, useState } from 'react';
import { Rocket, ScanSearch, ShieldCheck, Sparkles, X } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { toastCatch } from '@/lib/silentCatch';

import type { AppPassport } from './passportModel';
import { INK } from './passportInk';
import { applicableDeployActions } from './improve/deployActions';
import { useImprove } from './improve/ImproveContext';
import { dispatchRowToFleet, passportDispatchKey } from './passportFleet';

interface Direction {
  id: string;
  label: string;
  hint: string;
  fromScan: boolean;
  buildPrompt: (projectName: string) => string;
}

/** Generic app directions per row — always available, used to fill up to three
 *  slots when the scan offers fewer targeted ones. */
const GENERIC_DIRECTIONS: Record<string, Array<{ id: string; label: string; hint: string; prompt: string }>> = {
  tests: [
    { id: 'g-tests-scan', label: 'Scan test coverage', hint: 'map the suite, rank the untested critical paths', prompt: 'Map the current test coverage: run the existing suite, identify untested critical paths, and produce a ranked gap list with effort estimates. Do not change code yet — end with the report.' },
    { id: 'g-tests-harden', label: 'Harden critical paths', hint: 'write tests where a regression hurts most', prompt: 'Write tests for the highest-risk untested critical paths (auth, data writes, money/state transitions). Follow the repo’s existing test conventions and frameworks; commit atomically per covered path.' },
    { id: 'g-tests-stabilize', label: 'Stabilize the suite', hint: 'hunt flaky/slow tests, make CI trustworthy', prompt: 'Find flaky or slow tests: run the suite twice, diff outcomes, fix the flakes (timeouts, shared state, order dependence) and quarantine what cannot be fixed now with a tracking note.' },
  ],
  security: [
    { id: 'g-sec-scan', label: 'Scan for vulnerabilities', hint: 'dependency + code audit, ranked findings', prompt: 'Audit the codebase for security issues: dependency vulnerabilities, injection risks, secrets in code, unsafe defaults. Produce a ranked findings list with concrete fixes. Do not change code yet — end with the report.' },
    { id: 'g-sec-harden', label: 'Harden inputs & authz', hint: 'validate at boundaries, tighten access checks', prompt: 'Harden the highest-risk input boundaries and authorization checks found in the code: add validation, tighten permissive defaults, and cover each fix with a test. Commit atomically per boundary.' },
    { id: 'g-sec-gate', label: 'Gate CI with security checks', hint: 'make the pipeline catch regressions', prompt: 'Add security gates to the CI pipeline (dependency audit, static analysis appropriate to the stack, secret scanning). Keep the gates fast and actionable; document how to silence false positives.' },
  ],
  evals: [
    { id: 'g-evals-scan', label: 'Scan LLM call sites', hint: 'find prompts without evals, rank by blast radius', prompt: 'Inventory every LLM call site in the codebase (prompts, models, output contracts) and rank them by blast radius. Report which have evals, which do not, and what a minimal eval per site would assert. No code changes yet.' },
    { id: 'g-evals-author', label: 'Author evals for critical flows', hint: 'pin the behaviors that must not regress', prompt: 'Author evals for the most critical LLM flows: golden inputs with expected-output assertions, using the repo’s existing eval tooling if present (introduce a minimal harness if not). Commit atomically per flow.' },
    { id: 'g-evals-ci', label: 'Wire evals into CI', hint: 'run them on every change that touches prompts', prompt: 'Wire the existing evals into CI so they run on changes touching prompts or LLM plumbing. Keep the job fast (subset on PR, full on main) and make failures actionable.' },
  ],
  migrations: [
    { id: 'g-mig-scan', label: 'Scan schema drift', hint: 'compare live schema vs migrations story', prompt: 'Analyze the persistence layer: compare the actual schema with the migrations history, find drift, undocumented tables/columns, and destructive patterns. Report findings ranked by risk. No code changes yet.' },
    { id: 'g-mig-version', label: 'Version the migrations', hint: 'move to ordered, reproducible migrations', prompt: 'Introduce (or repair) versioned migrations: ordered, reproducible, with a clean bootstrap path for a fresh database. Migrate any ad-hoc schema changes into the sequence. Commit atomically.' },
    { id: 'g-mig-rollback', label: 'Add rollback safety', hint: 'down-paths or documented recovery per migration', prompt: 'Add rollback safety to the migrations story: down-migrations where the framework supports them, or documented recovery steps per irreversible migration. Verify the down-path on the most recent migration.' },
  ],
};

const ROW_ICON: Record<string, typeof ShieldCheck> = {
  tests: ScanSearch, security: ShieldCheck, evals: Sparkles, migrations: ScanSearch,
};

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
    const generics: Direction[] = (GENERIC_DIRECTIONS[rowKey] ?? []).map((g) => ({
      id: g.id,
      label: g.label,
      hint: g.hint,
      fromScan: false,
      buildPrompt: (projectName: string) => `Project “${projectName}”. ${g.prompt}`,
    }));
    return [...scanActs, ...generics.filter((g) => !scanActs.some((s) => s.label === g.label))].slice(0, 3);
  }, [rowKey, passport, raw]);

  const deploy = () => {
    const dir = directions.find((d) => d.id === selected);
    if (!dir || !raw) return;
    setBusy(true);
    const prompt =
      `${dir.buildPrompt(raw.project.name)}` +
      (instruction.trim() ? ` Additional instructions: ${instruction.trim()}.` : '') +
      ' Work in this repository. Commit atomically with clear messages, and finish with a short report of what changed and how to verify it.';
    dispatchRowToFleet(passportDispatchKey(rowKey, slug), raw.project.root_path, prompt)
      .then(() => { setBusy(false); onDispatched(); onClose(); })
      .catch((e) => { setBusy(false); toastCatch('passport fleet deploy')(e); });
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
