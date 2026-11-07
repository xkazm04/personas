// The improve popover's BODY, as a panel.
//
// This content used to exist only inside `DeployPopover`'s positioned shell:
// the "why this rating" provenance line, the level ladder, the connector icon
// grid, and the applicable golden-standard actions with their prompt preview,
// Queue / Deploy now, and "queue for all N projects that need this" batch.
//
// When the Database and Monitoring rows were given their own modals they
// stopped routing to that popover. The body was extracted so a modal COULD
// carry it verbatim; today only `DeployPopover` mounts it (the shell plus
// this). Monitoring reaches the same operations via `useImproveActions`, and
// the Database row has no action, ladder or connector spec to show.
//
// The OPERATIONS live in `useImproveActions`, not here — Console v2 renders the
// same ones in the modal's own visual language, and "queue for all N projects"
// must not exist twice.
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import { useState } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { Rocket, ScanSearch, ChevronDown, ChevronRight } from 'lucide-react';

import { useImprove } from './ImproveContext';
import { derivePassportFromMetadata } from '../passportDerive';
import { applicableDeployActions } from './deployActions';
import { ConnectorSection } from './ConnectorSection';
import { connectorSpecFor } from './connectors';
import { LevelLadder } from './LevelLadder';
import { ladderFor } from './levels';
import { useImproveActions } from './useImproveActions';

/** True when there is anything at all to render for this row — the popover uses
 *  it to decide whether to mount, a modal to decide whether to offer the tab. */
export function hasClassicContent(slug: string, rowKey: string, engine: ReturnType<typeof useImprove>): boolean {
  const raw = engine?.getRaw(slug);
  if (!engine || !raw) return false;
  const passport = derivePassportFromMetadata(raw.meta, raw.project, { hasSkills: raw.hasSkills, evidence: raw.evidence, skillCounts: raw.skillCounts, docRot: raw.docRot, memHealth: raw.memHealth });
  return applicableDeployActions(rowKey, passport).length > 0
    || Boolean(connectorSpecFor(rowKey)?.applicable(passport))
    || Boolean(ladderFor(rowKey, passport));
}

export function ImproveClassicPanel({ slug, rowKey, onDone }: {
  slug: string;
  rowKey: string;
  /** Called after a run starts. The popover closes; a modal may stay open. */
  onDone: () => void;
}) {
  const ops = useImproveActions(slug, rowKey, onDone);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!ops) return null;

  return (
    <div className="space-y-1.5">
      {ops.reason && (
        <div className="rounded-interactive border border-hair bg-surface-1 px-2 py-1.5">
          <span className="typo-caption text-ink-3 block mb-0.5" style={{ fontWeight: 400 }}>Why this rating</span>
          <span className="typo-caption text-ink-3" style={{ fontWeight: 400 }}>{ops.reason}</span>
        </div>
      )}
      {ops.hasLadder && <LevelLadder rowKey={rowKey} passport={ops.passport} />}
      {ops.showConnector && <ConnectorSection slug={slug} rowKey={rowKey} onClose={onDone} />}
      {ops.actions.map((a) => (
        <div key={a.id} className="rounded-interactive border border-hair bg-secondary/15 p-2">
          <div className="flex items-start gap-2">
            {a.kind === 'scan'
              ? <ScanSearch className="w-3.5 h-3.5 mt-0.5 text-primary/70 flex-shrink-0" aria-hidden />
              : <Rocket className="w-3.5 h-3.5 mt-0.5 text-primary/70 flex-shrink-0" aria-hidden />}
            <div className="min-w-0">
              <span className="typo-caption text-ink-2 block">{a.label}</span>
              <span className="typo-caption text-ink-3 block" style={{ fontWeight: 400 }}>{a.hint}</span>
            </div>
          </div>

          {a.kind === 'task' && (
            <Button variant="ghost" size="sm" className="mt-1.5" onClick={() => setExpanded((e) => (e === a.id ? null : a.id))} icon={expanded === a.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}>
{expanded === a.id ? 'Hide prompt' : 'View prompt'}
</Button>
          )}
          {a.kind === 'task' && expanded === a.id && (
            <pre className="mt-1 max-h-44 overflow-y-auto rounded-interactive bg-background/60 border border-hair p-2 typo-code text-ink-2 whitespace-pre-wrap">{ops.promptFor(a)}</pre>
          )}

          <div className="flex items-center justify-end gap-1.5 mt-2">
            {a.kind === 'scan' ? (
              ops.hasContextMap ? (
                <>
                  <ActionButton onClick={() => void ops.run(a, 'scan', true)} busy={ops.busy === a.id} label="Re-scan (incremental)" title="Only re-derives contexts for files changed since the last scan" />
                  <ActionButton primary onClick={() => void ops.run(a, 'scan', false)} busy={ops.busy === a.id} label="Full re-scan" title="Re-maps the whole repo from scratch" />
                </>
              ) : (
                <ActionButton primary onClick={() => void ops.run(a, 'scan', false)} busy={ops.busy === a.id} label="Run scan" />
              )
            ) : (
              <>
                <ActionButton onClick={() => void ops.run(a, 'queue')} busy={ops.busy === a.id} label="Queue task" />
                <ActionButton primary onClick={() => void ops.run(a, 'deploy')} busy={ops.busy === a.id} label="Deploy now" title="Runs Claude Code on the repo and opens a PR on green" />
              </>
            )}
          </div>
          {a.kind === 'task' && ops.batchSize(a) > 1 && (
            <PressSurface onPress={() => void ops.runBatch(a)} disabled={ops.busy === a.id} className="block ml-auto mt-1 typo-caption text-primary hover:underline">
              Queue for all {ops.batchSize(a)} projects that need this →
            </PressSurface>
          )}
        </div>
      ))}
    </div>
  );
}

function ActionButton({ label, onClick, busy, primary, title }: { label: string; onClick: () => void; busy: boolean; primary?: boolean; title?: string }) {
  return (
    <Button variant={primary ? "primary" : "secondary"} size="sm" onClick={onClick} disabled={busy} tooltip={title}>
      {busy ? '…' : label}
    </Button>
  );
}
