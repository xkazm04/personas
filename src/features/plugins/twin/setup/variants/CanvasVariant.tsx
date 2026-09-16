/**
 * CanvasVariant — Setup as the artifact it produces.
 *
 * The twin's passport is the surface: name, role, the biography taking shape,
 * a tone per channel and the bound channels as marks, all on one composed
 * card that fills in as the conversation proceeds. Every region is a real
 * editor (`session.edit`), so the typed path is complete here — a user who
 * never speaks to the guide can still finish the twin without the drawer.
 *
 * The conversation is demoted to a rail along one edge. When a proposal
 * arrives it is rendered INSIDE the region it would change, and that region
 * lights up, so Accept / Edit / Dismiss happens where the consequence is
 * visible rather than in a list somewhere else. Edit seeds the region's own
 * editor with the proposed text, still unsaved.
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { getToneChannelMeta, paletteOf } from '../../shared/channels';
import type { SetupFieldEdit, SetupProposal, SetupVariantProps } from '../setupContract';
import { SetupProposalRow } from '../SetupProposalRow';
import { CanvasField } from './CanvasField';
import { CanvasDock } from './CanvasDock';

/** Which passport region a proposal belongs to. Tone is per channel. */
const regionOf = (p: SetupProposal) => (p.kind === 'tone' ? `tone:${p.channel ?? 'generic'}` : p.kind);

export default function CanvasVariant({ session, voice }: SetupVariantProps) {
  const { t, tx } = useTranslation();
  const ts = t.twin.setup;
  const reduced = useReducedMotion();
  const [draft, setDraft] = useState('');
  const [seed, setSeed] = useState<{ key: string; value: string; nonce: number } | null>(null);

  const byRegion = useMemo(() => {
    const map: Record<string, SetupProposal[]> = {};
    for (const p of session.proposals) {
      const key = regionOf(p);
      const list = map[key] ?? [];
      list.push(p);
      map[key] = list;
    }
    return map;
  }, [session.proposals]);

  const composerValue = voice.listening && voice.interim ? voice.interim : draft;
  const bound = session.toneChannels.filter((c) => c !== 'generic');
  const channelFact = session.checklist.find((c) => c.id === 'channels')?.detail ?? '';

  const commit = (change: Omit<SetupFieldEdit, 'value'>) => (value: string) =>
    session.edit({ ...change, value } as SetupFieldEdit);

  const onAccept = async (p: SetupProposal) => {
    try {
      await session.accept(p);
    } catch (err) {
      toastCatch('features/plugins/twin/setup/variants/CanvasVariant:accept')(err);
    }
  };

  const send = () => {
    const text = composerValue.trim();
    if (!text) return;
    setDraft('');
    void session.answer(text).catch(toastCatch('features/plugins/twin/setup/variants/CanvasVariant:answer'));
  };

  const seedFor = (key: string) =>
    seed && seed.key === key ? { value: seed.value, nonce: seed.nonce } : undefined;

  const proposalsFor = (key: string) => {
    const list = byRegion[key];
    if (!list || list.length === 0) return null;
    return (
      <div className="px-2.5 pb-2 space-y-2">
        {list.map((p) => (
          <SetupProposalRow
            key={p.id}
            proposal={p}
            onAccept={onAccept}
            onEdit={(x) => setSeed({ key, value: x.value, nonce: Date.now() })}
            onDismiss={session.dismiss}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 xl:px-8 py-5">
        <motion.div
          data-testid="setup-canvas-passport"
          className="mx-auto max-w-[640px] rounded-card border border-primary/20 bg-card/60 shadow-elevation-2 overflow-hidden"
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.3, ease: 'easeOut' }}
        >
          <div className="flex items-start gap-3 p-3 border-b border-primary/10 bg-secondary/20">
            <span className="w-12 h-12 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-primary" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <CanvasField
                label={ts.fields.name} value={session.values.name ?? ''} emptyText={ts.canvas.nameEmpty}
                scale="title" testId="setup-canvas-name" onCommit={commit({ field: 'name' })}
              />
              <CanvasField
                label={ts.fields.role} value={session.values.role ?? ''} emptyText={ts.canvas.roleEmpty}
                highlighted={Boolean(byRegion.role)} seed={seedFor('role')}
                testId="setup-canvas-role" onCommit={commit({ field: 'role' })}
              >
                {proposalsFor('role')}
              </CanvasField>
            </div>
          </div>

          <div className="p-3 space-y-2">
            <CanvasField
              label={ts.fields.bio} value={session.values.bio ?? ''} emptyText={ts.canvas.bioEmpty} multiline
              highlighted={Boolean(byRegion.bio)} seed={seedFor('bio')}
              testId="setup-canvas-bio" onCommit={commit({ field: 'bio' })}
            >
              {proposalsFor('bio')}
            </CanvasField>

            <div className="pt-2 border-t border-primary/10">
              <p className="px-2.5 typo-caption uppercase tracking-[0.18em]">{ts.fields.toneGroup}</p>
              <div className="mt-1 space-y-1">
                {session.toneChannels.map((ch) => (
                  <CanvasField
                    key={ch}
                    label={tx(ts.fields.toneFor, { channel: getToneChannelMeta(ch).label })}
                    value={session.values[`tone:${ch}`] ?? ''} emptyText={ts.canvas.toneEmpty} multiline
                    highlighted={Boolean(byRegion[`tone:${ch}`])} seed={seedFor(`tone:${ch}`)}
                    testId={`setup-canvas-tone-${ch}`} onCommit={commit({ field: 'tone', channel: ch })}
                  >
                    {proposalsFor(`tone:${ch}`)}
                  </CanvasField>
                ))}
              </div>
            </div>

            {/* Bound channels as marks — the passport's stamps, not a list. */}
            <button
              type="button"
              onClick={() => session.focusOn('channels')}
              data-testid="setup-canvas-channels"
              className="w-full rounded-card border border-transparent px-2.5 py-2 text-left transition-colors hover:border-primary/25 hover:bg-secondary/25"
            >
              <span className="flex items-baseline gap-2">
                <span className="typo-caption uppercase tracking-[0.18em]">{ts.canvas.channelsGroup}</span>
                <span className="typo-caption tabular-nums">{channelFact}</span>
              </span>
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {bound.length === 0 && <span className="typo-caption">{ts.canvas.channelsEmpty}</span>}
                {bound.map((id) => {
                  const pal = paletteOf(getToneChannelMeta(id));
                  return (
                    <span key={id} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full typo-caption ${pal.bg}`}>
                      <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${pal.dot}`} />
                      {getToneChannelMeta(id).label}
                    </span>
                  );
                })}
              </span>
            </button>
          </div>
        </motion.div>

        <p className="mx-auto max-w-[640px] mt-2 typo-caption">{ts.canvas.editHint}</p>
      </div>

      <CanvasDock
        question={session.question}
        suggestions={session.suggestions.slice(0, 3)}
        busy={session.busy}
        value={composerValue}
        onChange={setDraft}
        onSubmit={send}
        onPick={setDraft}
        onSkip={() => void session.skip().catch(toastCatch('features/plugins/twin/setup/variants/CanvasVariant:skip'))}
        voice={voice}
      />
    </div>
  );
}
