import { useState } from 'react';
import { Workflow } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { applyLifecycleProposal } from '@/api/companion/lifecycle';
import type { LifecycleProposalCard as Proposal } from '@/lib/bindings/LifecycleProposalCard';
import { resolveChatCard } from '../useChatCards';
import { LifecycleProposalRow } from './LifecycleProposalRow';

/** Parse the `lifecycle_proposal` chat-card config. `null` = not a proposal. */
export function parseLifecycleProposal(raw: unknown): Proposal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.projectId !== 'string' ||
    typeof r.projectName !== 'string' ||
    typeof r.fromVersion !== 'number' ||
    (r.preset !== 'solo' && r.preset !== 'team') ||
    !Array.isArray(r.changes) ||
    r.changes.length === 0
  ) {
    return null;
  }
  // INVARIANT: the dispatcher serialized a validated `LifecycleProposalCard`
  // (serde camelCase, `show_lifecycle_proposal` arm) into this config; the
  // fields checked above are the ones this card reads unconditionally.
  return raw as Proposal;
}

/** What a confirmed card remembers (patched into its config for this session). */
interface Applied {
  version: number;
  installTaskId: string | null;
}

function readApplied(config: Record<string, unknown> | undefined): Applied | null {
  const a = config?.applied;
  if (typeof a !== 'object' || a === null) return null;
  const v = (a as Record<string, unknown>).version;
  const id = (a as Record<string, unknown>).installTaskId;
  return typeof v === 'number' ? { version: v, installTaskId: typeof id === 'string' ? id : null } : null;
}

/**
 * Athena's lifecycle proposal, in CHAT.
 *
 * She reads the project's lifecycle (`describe_lifecycle`) and proposes the
 * full next step list (`show_lifecycle_proposal`); the dispatcher validates it
 * and diffs it into the changes listed here. Every change is ticked by default
 * and can be unticked. Confirm sends only the card id and the ticked ids: the
 * backend reads the proposal back from the durable row, applies the ticked
 * changes on top of the version it was drawn from, and refuses a stale card.
 */
export function LifecycleProposalCard({
  config,
  title,
  cardId,
}: {
  config?: Record<string, unknown>;
  title?: string;
  /** Durable `companion_chat_card` row id. Confirm needs it: the proposal is read back by id. */
  cardId?: string;
}) {
  const { t, tx } = useTranslation();
  const c = t.athena;
  const proposal = parseLifecycleProposal(config);
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(proposal?.changes.map((ch) => ch.stepId) ?? []),
  );
  const [applied, setApplied] = useState<Applied | null>(() => readApplied(config));
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || proposal === null) return null;

  const nextVersion = proposal.fromVersion + 1;

  if (applied !== null) {
    return (
      <div
        className="rounded-card border border-status-success/30 bg-status-success/[0.06] p-3 space-y-1"
        data-testid="lc-proposal-card"
      >
        <p className="typo-card-label text-foreground" data-testid="lc-proposal-saved">
          {tx(c.lifecycle_proposal_saved, { version: applied.version })}
        </p>
        <p className="typo-caption text-foreground">
          {applied.installTaskId !== null
            ? c.lifecycle_proposal_install_started
            : c.lifecycle_proposal_install_none}
        </p>
      </div>
    );
  }

  const hasPresetChange = proposal.changes.some((ch) => ch.kind === 'preset');
  const toPreset = proposal.preset;
  const fromPreset = hasPresetChange ? (toPreset === 'team' ? 'solo' : 'team') : toPreset;

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = async () => {
    if (!cardId) return;
    setError(null);
    const accepted = proposal.changes.map((ch) => ch.stepId).filter((id) => ticked.has(id));
    try {
      const snapshot = await applyLifecycleProposal(cardId, accepted);
      const result: Applied = {
        version: snapshot.version,
        installTaskId: snapshot.installTaskId ?? null,
      };
      setApplied(result);
      // The backend already claimed the row and stored the outcome; this only
      // patches the in-memory card so a re-render keeps the saved state.
      resolveChatCard(cardId, 'dispatched', { applied: result });
    } catch (err: unknown) {
      // Resolved at the set site: the stale-version refusal and every other
      // backend sentence go through the error registry before they are shown.
      setError(resolveErrorTranslated(t, err instanceof Error ? err.message : String(err)).message);
    }
  };

  const count = proposal.changes.length;

  return (
    <div
      className="rounded-card border border-primary/30 bg-primary/[0.04] p-4 space-y-3"
      data-testid="lc-proposal-card"
    >
      <header className="flex items-baseline gap-2">
        <Workflow className="w-3.5 h-3.5 text-primary shrink-0 translate-y-0.5" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="typo-card-label text-foreground break-words">
            {title || c.lifecycle_proposal_heading}
          </p>
          <p className="typo-caption text-foreground" data-testid="lc-proposal-versions">
            {tx(c.lifecycle_proposal_versions, {
              project: proposal.projectName,
              from: proposal.fromVersion,
              to: nextVersion,
            })}
            {' · '}
            {tx(
              count === 1
                ? c.lifecycle_proposal_change_count_one
                : c.lifecycle_proposal_change_count_other,
              { count },
            )}
          </p>
        </div>
      </header>

      {proposal.changeNote && (
        <p className="typo-body text-foreground break-words" data-testid="lc-proposal-note">
          {proposal.changeNote}
        </p>
      )}

      <ul className="space-y-2">
        {proposal.changes.map((ch) => (
          <LifecycleProposalRow
            key={ch.stepId}
            change={ch}
            checked={ticked.has(ch.stepId)}
            onToggle={() => toggle(ch.stepId)}
            fromPreset={fromPreset}
            toPreset={toPreset}
          />
        ))}
      </ul>

      {error !== null && (
        <p className="typo-caption text-status-error break-words" data-testid="lc-proposal-error">
          {error}
        </p>
      )}

      <p className="typo-caption text-foreground">
        {ticked.size === 0 ? c.lifecycle_proposal_nothing_ticked : c.lifecycle_proposal_note}
      </p>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDismissed(true);
            resolveChatCard(cardId, 'dismissed');
          }}
          data-testid="lc-proposal-dismiss"
        >
          {c.lifecycle_proposal_dismiss}
        </Button>
        <AsyncButton
          variant="primary"
          size="sm"
          disabled={ticked.size === 0 || !cardId}
          onClick={confirm}
          data-testid="lc-proposal-confirm"
        >
          {tx(c.lifecycle_proposal_confirm, { version: nextVersion })}
        </AsyncButton>
      </div>
    </div>
  );
}
