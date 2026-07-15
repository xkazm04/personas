// "Sweep findings" — the manual trigger for the findings sweep (docs/plans/
// dev-findings-loop.md §3 2C). Auto-scheduling is Phase 3; a button the user
// presses is the honest starting point.
//
// The Triage page can reach the project row, the vault, the standards scan, and
// the two telemetry connectors directly. The passport-gap and KPI emitters need
// Factory-side state that lives on another route, so this trigger runs WITHOUT
// them — and the result toast names every sensor it skipped, so a thin sweep is
// never mistaken for a clean bill of health.
import { useState } from 'react';
import { Radar } from 'lucide-react';

import { useVaultStore } from '@/stores/vaultStore';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { usePassportForProject } from './usePassportForProject';

import { runFindingSweep } from './sweep';

export function SweepButton({
  projectId,
  onSwept,
}: {
  projectId: string | null;
  onSwept: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const credentials = useVaultStore((s) => s.credentials);
  const projects = useSystemStore((s) => s.projects);
  const ideas = useSystemStore((s) => s.ideas);
  const tasks = useSystemStore((s) => s.tasks);
  const addToast = useToastStore((s) => s.addToast);
  const passport = usePassportForProject(projectId);

  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;

  const run = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const res = await runFindingSweep({
        project,
        credentials,
        passport: passport ?? undefined,
        // Enables verification: the same emit that raises new findings also judges
        // the shipped ones (docs/plans/dev-findings-loop.md §7).
        ideas,
        tasks,
      });
      const parts = [`${res.created} raised`];
      if (res.duplicates > 0) parts.push(`${res.duplicates} already known`);
      if (res.dropped > 0) parts.push(`${res.dropped} over the cap`);

      // Verdicts. `unchanged` / `regressed` are surfaced as loudly as `cleared` —
      // the whole point of the phase is that "merged" is not "fixed".
      const v = res.verified;
      const verdicts: string[] = [];
      if (v.cleared) verdicts.push(`${v.cleared} cleared`);
      if (v.moved) verdicts.push(`${v.moved} moved`);
      if (v.unchanged) verdicts.push(`${v.unchanged} unchanged`);
      if (v.regressed) verdicts.push(`${v.regressed} REGRESSED`);
      if (verdicts.length > 0) parts.push(`verified: ${verdicts.join(', ')}`);

      if (res.skippedSensors.length > 0) parts.push(`skipped: ${res.skippedSensors.join(', ')}`);

      // A regression is bad news and must not wear a success colour.
      const tone = v.regressed > 0 ? 'error' : res.created > 0 || verdicts.length > 0 ? 'success' : 'warning';
      addToast(`Sweep — ${parts.join(' · ')}`, tone);
      onSwept();
    } catch (e) {
      toastCatch('features/plugins/dev-tools/sub_triage/findings/sweep')(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip content="Sweep every sensor for new findings">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || !project}
        aria-label="Sweep findings"
        data-testid="findings-sweep"
        className="w-7 h-7 rounded-card bg-primary/5 border border-primary/10 flex items-center justify-center hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? <LoadingSpinner size="xs" /> : <Radar className="w-3.5 h-3.5 text-foreground" />}
      </button>
    </Tooltip>
  );
}
