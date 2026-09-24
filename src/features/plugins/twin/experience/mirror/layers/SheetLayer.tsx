/**
 * What the twin knows, one layer down.
 *
 * Everything stored so far, in the order it was learned: who they are, how
 * they sound on each channel and how much evidence there is for it, and what
 * the Brain holds. It is a READOUT, not an editor — the two doors at the
 * bottom lead to the surfaces that do edit, because a panel that half-edits is
 * the thing this variant is built to avoid.
 *
 * The per-voice counts are the reward loop: they are why answering a reply
 * drill feels like it did something.
 */

import { BookOpenText, ExternalLink, MessageSquareQuote, ShieldCheck, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupSessionApi } from '../../../setup/setupContract';
import { channelName, countItems } from '../channels';
import { LayerFrame } from './LayerFrame';

interface SheetLayerProps {
  open: boolean;
  onClose: () => void;
  session: SetupSessionApi;
  onOpenFields: () => void;
  onOpenHub: () => void;
}

export function SheetLayer({ open, onClose, session, onOpenFields, onOpenHub }: SheetLayerProps) {
  const { t, tx } = useTranslation();
  const mr = t.twin.experience_mirror.sheet;
  const { values } = session;
  const memories = session.checklist.find((c) => c.id === 'memories')?.detail ?? '';

  return (
    <LayerFrame
      open={open}
      onClose={onClose}
      icon={<BookOpenText className="w-4 h-4" />}
      title={mr.title}
      hint={mr.hint}
      testId="mr-sheet"
    >
      <div className="px-5 py-4 space-y-5">
        <section className="space-y-1">
          <p className="typo-title-lg text-foreground">{values.name}</p>
          <p className="typo-caption">{values.role || mr.noRole}</p>
          <p className="typo-body text-foreground pt-1">{values.bio || mr.noBio}</p>
        </section>

        <section className="space-y-2" aria-labelledby="mr-sheet-voices">
          <h4 id="mr-sheet-voices" className="typo-title text-foreground">
            {mr.voices}
          </h4>
          <ul className="space-y-1.5">
            {session.toneChannels.map((channel) => {
              const samples = countItems(values[`tone:${channel}:examples`]);
              const rules = countItems(values[`tone:${channel}:constraints`]);
              return (
                <li
                  key={channel}
                  className="mr-frame rounded-card px-3 py-2 flex items-center gap-3"
                  data-testid={`mr-sheet-voice-${channel}`}
                >
                  <span className="min-w-0 flex-1 truncate typo-body text-foreground">
                    {channelName(channel, mr.everywhere)}
                    {!values[`tone:${channel}`] && <span className="ml-1.5 typo-caption">{mr.noVoice}</span>}
                  </span>
                  <span className="sr-only">{tx(mr.samplesAndRules, { samples, rules })}</span>
                  <span aria-hidden className="inline-flex items-center gap-1 typo-data text-foreground tabular-nums">
                    <MessageSquareQuote className="w-3.5 h-3.5 text-primary" />
                    {samples}
                  </span>
                  <span aria-hidden className="inline-flex items-center gap-1 typo-data text-foreground tabular-nums">
                    <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                    {rules}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex items-center gap-2 typo-body text-foreground">
          <Sparkles className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          {tx(mr.memories, { detail: memories })}
        </section>

        <div className="flex flex-wrap gap-2 pt-1 border-t border-primary/10">
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenFields}
            icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
            data-testid="mr-sheet-fields"
          >
            {mr.openFields}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenHub}
            icon={<ExternalLink className="w-3.5 h-3.5" />}
            data-testid="mr-sheet-hub"
          >
            {t.twin.setup.desk.openHub}
          </Button>
        </div>
      </div>
    </LayerFrame>
  );
}

export default SheetLayer;
