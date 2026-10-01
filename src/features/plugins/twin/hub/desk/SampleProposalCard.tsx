/**
 * One proposal a writing sample produced (spark twin-portable-blueprint):
 * what kind of change it is, for which channel, where its sample came from,
 * the value itself, why the analysis proposed it, and Keep / Edit / Dismiss.
 *
 * Nothing is written until Keep: an exemplar joins the channel's samples, a
 * voice rule its directives, a do/don't its constraints, a length its length
 * hint, and style dims its stored style (recorded as `learned`). Edit keeps an
 * edited value instead. Style dims are kept or dismissed whole: there is no
 * text to edit, and the dimensions are tuned in the voice studio.
 */

import { useState } from 'react';
import { Check, ListChecks, Pencil, Quote, Ruler, ScrollText, SlidersHorizontal, X, type LucideIcon } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { safeJsonParse } from '@/lib/utils/parseJson';
import type { TwinSampleProposalKind } from '@/api/twin/twinSample';
import type { TwinSample } from '@/lib/bindings/TwinSample';
import { DimensionChips } from '../../setup/style/DimensionChips';
import { STYLE_DIMENSIONS, STYLE_MAX, STYLE_MIN, type TwinStyleDims } from '../../setup/style/styleContract';
import { channelName } from '../../experience/channels';
import type { HubSampleProposal } from '../hubContract';

type Translations = ReturnType<typeof useTranslation>['t'];

const KIND_ICON: Record<TwinSampleProposalKind, LucideIcon> = {
  exemplar: Quote,
  voice: ScrollText,
  constraint: ListChecks,
  length: Ruler,
  dims: SlidersHorizontal,
};

function kindOf(raw: string): TwinSampleProposalKind {
  return raw === 'voice' || raw === 'constraint' || raw === 'length' || raw === 'dims' ? raw : 'exemplar';
}

function kindLabel(t: Translations, kind: TwinSampleProposalKind): string {
  const s = t.twin.samples;
  return { exemplar: s.kindExemplar, voice: s.kindVoice, constraint: s.kindConstraint, length: s.kindLength, dims: s.kindDims }[kind];
}

/** Every dimension present as an integer in range: the shape the style door accepts. */
function isDims(value: unknown): value is TwinStyleDims {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return STYLE_DIMENSIONS.every((d) => Number.isInteger(v[d]) && (v[d] as number) >= STYLE_MIN && (v[d] as number) <= STYLE_MAX);
}

/** Where the proposal's sample came from, in words. */
export function sourceLine(t: Translations, tx: (s: string, v: Record<string, string>) => string, sample: TwinSample | null): string | null {
  if (!sample) return null;
  if (sample.sourceKind === 'forge') return t.twin.samples.fromForge;
  if (sample.sourceKind === 'selection' && sample.sourceHost) return tx(t.twin.samples.fromHost, { host: sample.sourceHost });
  return t.twin.samples.fromClipboard;
}

interface SampleProposalCardProps {
  item: HubSampleProposal;
  busy: boolean;
  error: string | null;
  onResolve: (verdict: 'accept' | 'dismiss', editedValue?: string | null) => Promise<void>;
}

export function SampleProposalCard({ item, busy, error, onResolve }: SampleProposalCardProps) {
  const { t, tx } = useTranslation();
  const s = t.twin.samples;
  const { proposal, sample } = item;
  const kind = kindOf(proposal.kind);
  const Icon = KIND_ICON[kind];
  const [draft, setDraft] = useState<string | null>(null);
  const [dims] = kind === 'dims' ? safeJsonParse(proposal.value, isDims) : [null];
  const source = sourceLine(t, tx, sample);

  return (
    <article className="rounded-card border border-primary/15 bg-card-bg p-3 space-y-2" data-testid={`sample-proposal-${proposal.id}`}>
      <header className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-pill border border-primary/30 bg-primary/10 text-primary">
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="typo-label">{kindLabel(t, kind)}</span>
        </span>
        <span className="typo-label text-foreground">
          {tx(s.forChannel, { channel: channelName(proposal.channel, t.twin.experience.sheet.everywhere) })}
        </span>
        <RelativeTime timestamp={proposal.createdAt} className="ml-auto typo-caption text-foreground" />
      </header>
      {source && <p className="typo-caption">{source}</p>}

      {draft !== null ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={s.edit}
          rows={kind === 'exemplar' ? 5 : 2}
          className={`${INPUT_FIELD} resize-y`}
          data-testid="sample-proposal-edit-field"
        />
      ) : dims ? (
        <DimensionChips dims={dims} dense />
      ) : (
        <p className={`typo-body text-foreground whitespace-pre-wrap ${kind === 'exemplar' ? 'border-l-2 border-primary/30 pl-3' : ''}`}>
          {proposal.value}
        </p>
      )}
      {proposal.reason && <p className="typo-caption">{proposal.reason}</p>}
      {error && <p role="alert" className="typo-caption text-status-error">{error}</p>}

      <div className="flex items-center gap-2">
        {draft !== null ? (
          <>
            <AsyncButton size="xs" variant="accent" tone="success" isLoading={busy} disabled={!draft.trim()}
              icon={<Check className="w-3.5 h-3.5" />} onClick={() => onResolve('accept', draft.trim())}
              data-testid="sample-proposal-save">
              {t.common.save}
            </AsyncButton>
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => setDraft(null)} data-testid="sample-proposal-edit-cancel">
              {t.common.cancel}
            </Button>
          </>
        ) : (
          <>
            <AsyncButton size="xs" variant="accent" tone="success" isLoading={busy}
              icon={<Check className="w-3.5 h-3.5" />} onClick={() => onResolve('accept')} data-testid="sample-proposal-keep">
              {s.keep}
            </AsyncButton>
            {kind !== 'dims' && (
              <Button size="xs" variant="ghost" disabled={busy} icon={<Pencil className="w-3.5 h-3.5" />}
                onClick={() => setDraft(proposal.value)} data-testid="sample-proposal-edit">
                {s.edit}
              </Button>
            )}
            <AsyncButton size="xs" variant="ghost" disabled={busy}
              icon={<X className="w-3.5 h-3.5" />} onClick={() => onResolve('dismiss')} data-testid="sample-proposal-dismiss">
              {s.dismiss}
            </AsyncButton>
          </>
        )}
      </div>
    </article>
  );
}
