// The dispatch entry for `/ship-milestone` plus the door its results come back
// through. Two controls, one pair, deliberately adjacent: a run that never gets
// ingested executed the milestone invisibly, which is the whole risk of running
// it as a CLI skill instead of an in-app op.
//
// Dispatch is EXACTLY one positional token (`/ship-milestone <id>`) — the
// spawner appends `--mcp-config` last, and anything after that flag is
// swallowed by it.
import { useState } from 'react';
import { Download, SquareTerminal } from 'lucide-react';

import { spawnSession } from '@/api/fleet/fleet';
import { shipMilestoneIngest, type ShipMilestoneIngestSummary } from '@/api/devTools/milestones';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { skillCommand } from '../../passport/improve/skillsWorkbenchData';
import { INK } from '../../passport/passportInk';

/** The ingest result, reported inline. Proposals are shown as PROPOSALS — the
 *  door refuses to apply them, and this panel does not offer to either. */
function RunSummary({ summary, onDismiss }: {
  summary: ShipMilestoneIngestSummary;
  onDismiss: () => void;
}) {
  const { t, tx } = useTranslation();
  return (
    <div
      className="mt-2 rounded-card border px-3 py-2.5"
      style={{ borderColor: `${INK.teal}44`, background: `color-mix(in srgb, ${INK.teal} 5%, transparent)` }}
      data-testid="ship-run-summary"
    >
      <p className="typo-title mb-1">{t.ship.run_ingest_title}</p>
      <p className="typo-caption">
        {tx(t.ship.run_ingest_counts, {
          updated: summary.itemsUpdated,
          ratings: summary.ratingsSet,
          descriptions: summary.descriptionsSet,
          reported: summary.itemsReported,
        })}
      </p>
      {summary.summary && <p className="typo-caption mt-1.5">{summary.summary}</p>}

      {summary.proposedAdditions.length > 0 && (
        <div className="mt-2.5">
          <p className="typo-caption font-medium" style={{ color: INK.violet }}>
            {tx(t.ship.run_proposed_title, { count: summary.proposedAdditions.length })}
          </p>
          <p className="typo-caption mb-1">{t.ship.run_proposed_hint}</p>
          <ul className="flex flex-col gap-1">
            {summary.proposedAdditions.map((a) => (
              <li key={`${a.itemKind}:${a.name}`} className="typo-caption">
                <span className="text-foreground">{a.name}</span>
                {a.rationale && <span className="opacity-70"> · {a.rationale}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.questionsAsked.length > 0 && (
        <div className="mt-2.5">
          <p className="typo-caption font-medium">{t.ship.run_asked_title}</p>
          <ul className="flex flex-col gap-0.5">
            {summary.questionsAsked.map((q) => (
              <li key={q} className="typo-caption">{q}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 typo-caption text-foreground transition-colors hover:opacity-70 focus-ring rounded-interactive"
      >
        {t.common.dismiss}
      </button>
    </div>
  );
}

/** Run + ingest, for one milestone. `rootPath` null while the project loads. */
export function ShipMilestoneRun({ milestoneId, rootPath }: {
  milestoneId: string;
  rootPath: string | null;
}) {
  const { t } = useTranslation();
  const [spawning, setSpawning] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [summary, setSummary] = useState<ShipMilestoneIngestSummary | null>(null);

  const run = async () => {
    if (!rootPath) return;
    setSpawning(true);
    try {
      await spawnSession(rootPath, [skillCommand('ship-milestone', milestoneId)]);
      void useSystemStore.getState().fleetRefresh();
    } catch (e) {
      toastCatch('ship milestone run')(e);
    } finally {
      setSpawning(false);
    }
  };

  const ingest = async () => {
    setIngesting(true);
    try {
      setSummary(await shipMilestoneIngest(milestoneId));
    } catch (e) {
      // The door refuses rather than partially applying, so a failure here
      // means nothing was written — the reason is the whole message.
      toastCatch('ship milestone ingest')(e);
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div data-testid="ship-milestone-run">
      <span className="inline-flex items-center gap-2">
        <AsyncButton
          isLoading={spawning}
          disabled={!rootPath}
          onClick={() => void run()}
          icon={<SquareTerminal className="w-3.5 h-3.5" aria-hidden />}
          title={t.ship.run_milestone_tooltip}
          data-testid="ship-run-milestone"
        >
          {t.ship.run_milestone}
        </AsyncButton>
        <AsyncButton
          isLoading={ingesting}
          onClick={() => void ingest()}
          icon={<Download className="w-3.5 h-3.5" aria-hidden />}
          title={t.ship.run_ingest_tooltip}
          data-testid="ship-ingest-run"
        >
          {t.ship.run_ingest}
        </AsyncButton>
      </span>
      {summary && <RunSummary summary={summary} onDismiss={() => setSummary(null)} />}
    </div>
  );
}
