/**
 * An offer: a value the guide (or the person's own reply) proposes for a real
 * field. It turns over as it arrives, wearing a holographic sheen, because it
 * is the one thing on the table that can be KEPT.
 *
 * Nothing is written on silence: the card has no timer and no default. Keep
 * writes it; Edit moves it into the composer so the person says it their way;
 * Pass lets it go. A resolved card stays on the table, stamped with what was
 * decided, until the next question — the record of the turn.
 */

import { Check, Pencil, X } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupProposal } from '../../../setup/setupContract';
import type { SetupProposalResolution } from '../../../setup/SetupProposalRow';
import { channelName } from '../suits';

interface LootCardProps {
  proposal: SetupProposal;
  resolution: SetupProposalResolution | undefined;
  onKeep: (proposal: SetupProposal) => Promise<void>;
  onEdit: (proposal: SetupProposal) => void;
  onPass: (proposal: SetupProposal) => void;
}

/** The suit an offer belongs to, which sets its hue. */
function hueOf(proposal: SetupProposal): string {
  return proposal.kind === 'tone' ? 'xo-suit-tone' : 'xo-suit-identity';
}

export function LootCard({ proposal, resolution, onKeep, onEdit, onPass }: LootCardProps) {
  const { t, tx } = useTranslation();
  const loot = t.twin.experience_opus.loot;
  const part = proposal.kind === 'tone' ? (proposal.part ?? 'voice') : null;
  const kindLabel =
    proposal.kind === 'tone' ? loot.kind[proposal.part ?? 'voice'] : loot.kind[proposal.kind];
  const label = proposal.channel
    ? tx(loot.onChannel, { kind: kindLabel, channel: channelName(proposal.channel, t.twin.experience_opus.twinCard.everywhere) })
    : kindLabel;
  const reason = part === 'examples' ? loot.sampleReason : proposal.reason;

  return (
    <div
      className={`${hueOf(proposal)} xo-card xo-card-raised xo-foil rounded-modal overflow-hidden ${
        resolution ? 'xo-foil-quiet' : 'xo-foil-live xo-holo xo-glow'
      }`}
      data-testid={`xo-loot-${part ?? proposal.kind}`}
    >
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="typo-label uppercase text-[var(--xo-hue)]">{label}</span>
        {proposal.lengthHint && <span className="typo-caption">{proposal.lengthHint}</span>}
        {resolution && (
          <span
            className={`ml-auto px-2 py-0.5 rounded-pill border typo-label ${
              resolution === 'accepted'
                ? 'border-status-success/40 text-status-success'
                : 'border-foreground/15 text-foreground'
            }`}
            data-testid={`xo-loot-stamp-${resolution}`}
          >
            {loot.stamp[resolution]}
          </span>
        )}
      </div>

      <p
        className={`px-4 pt-2 pb-1 typo-body-lg whitespace-pre-wrap ${
          resolution === 'dismissed' ? 'text-foreground line-through decoration-foreground/30' : 'text-foreground'
        } ${resolution ? 'line-clamp-2' : ''}`}
      >
        {proposal.value}
      </p>
      {reason && !resolution && <p className="px-4 pb-2 typo-caption">{reason}</p>}

      {!resolution && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-primary/10">
          <AsyncButton
            size="sm"
            variant="accent"
            accentColor="violet"
            icon={<Check className="w-3.5 h-3.5" />}
            onClick={() => onKeep(proposal)}
            data-testid="xo-loot-keep"
          >
            {loot.keep}
          </AsyncButton>
          <Button
            size="sm"
            variant="ghost"
            icon={<Pencil className="w-3.5 h-3.5" />}
            onClick={() => onEdit(proposal)}
            data-testid="xo-loot-edit"
          >
            {loot.edit}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<X className="w-3.5 h-3.5" />}
            onClick={() => onPass(proposal)}
            data-testid="xo-loot-pass"
            className="ml-auto"
          >
            {loot.pass}
          </Button>
        </div>
      )}
    </div>
  );
}

export default LootCard;
