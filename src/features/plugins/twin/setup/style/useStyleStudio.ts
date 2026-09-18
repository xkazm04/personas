/**
 * The Style studio's engine: one phase machine over browse, roll, materialize,
 * preview and apply.
 *
 * What it holds, and why:
 * 1. **Proposals never write.** Roll and materialize only fill state; the one
 *    write is `accept()`, over the channels the user left ticked.
 * 2. **A failure keeps what was there.** A failed roll leaves the previous
 *    candidates on screen, a failed materialize returns to where the user came
 *    from, a failed apply stays on the preview. The error is inline, never a
 *    blank panel.
 * 3. **The latest request wins.** Every call mints a token; a reroll issued
 *    while an earlier roll is in flight supersedes it, and `back()` retires an
 *    in-flight materialize so a late reply cannot yank the user into a preview.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as twinApi from '@/api/twin/twin';
import { useSystemStore } from '@/stores/systemStore';
import { createLatestWins } from '@/stores/util/latestWins';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import { resolveError } from '@/lib/errors/errorRegistry';
import { useTranslation } from '@/i18n/useTranslation';
import { targetsFor } from './channelShift';
import { presetById } from './stylePresets';
import type {
  StyleCandidate,
  StyleDimension,
  StylePresetId,
  StyleStudioApi,
  StyleStudioError,
  StyleStudioPhase,
  StyleToneDraft,
  TwinStyle,
  TwinStyleDims,
  TwinStylePins,
} from './styleContract';

const NO_PINS: TwinStylePins = {
  formality: null,
  warmth: null,
  humor: null,
  energy: null,
  length: null,
  directness: null,
  expressiveness: null,
  detail: null,
};

type ReturnPhase = 'browse' | 'candidates';

function failure(step: StyleStudioError['step'], e: unknown): StyleStudioError {
  return { step, message: resolveError(extractMessage(e)).message };
}

export function useStyleStudio(twinId: string | null, channels: string[]): StyleStudioApi {
  const { t } = useTranslation();
  const presetCopy = t.twin.style.presets;
  const fetchTwinTones = useSystemStore((s) => s.fetchTwinTones);

  const [phase, setPhase] = useState<StyleStudioPhase>('browse');
  const [returnTo, setReturnTo] = useState<ReturnPhase>('browse');
  const [pins, setPins] = useState<TwinStylePins>(NO_PINS);
  const [candidates, setCandidates] = useState<StyleCandidate[]>([]);
  /* Every candidate shown this session, sent back as `avoid` on a reroll. */
  const [seen, setSeen] = useState<TwinStyleDims[]>([]);
  const [chosen, setChosen] = useState<TwinStyle | null>(null);
  const [drafts, setDrafts] = useState<StyleToneDraft[]>([]);
  const [selectedChannels, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<StyleStudioError | null>(null);
  const [latest] = useState(createLatestWins);

  // A different twin is a different subject: nothing carries across.
  useEffect(() => {
    latest.next();
    setPhase('browse');
    setPins(NO_PINS);
    setCandidates([]);
    setSeen([]);
    setChosen(null);
    setDrafts([]);
    setSelected(new Set());
    setError(null);
  }, [twinId, latest]);

  const togglePin = useCallback((dim: StyleDimension, value: number) => {
    setPins((current) => ({ ...current, [dim]: current[dim] === value ? null : value }));
  }, []);
  const clearPins = useCallback(() => setPins(NO_PINS), []);

  const materialize = useCallback(
    async (style: TwinStyle, from: ReturnPhase) => {
      if (!twinId) return;
      const token = latest.next();
      setReturnTo(from);
      setChosen(style);
      setError(null);
      setPhase('materializing');
      try {
        const next = await twinApi.materializeTwinStyle(twinId, style, targetsFor(style.dims, channels));
        if (!latest.isCurrent(token)) return;
        setDrafts(next);
        setSelected(new Set(next.map((d) => d.channel)));
        setPhase('preview');
      } catch (e) {
        if (!latest.isCurrent(token)) return;
        setError(failure('materialize', e));
        setPhase(from);
      }
    },
    [twinId, channels, latest],
  );

  const pickPreset = useCallback(
    async (id: StylePresetId) => {
      const preset = presetById(id);
      if (!preset) return;
      // The copy travels to the model in the user's language. A section that
      // has not loaded yet degrades to the id rather than throwing.
      const copy = presetCopy?.[id];
      await materialize(
        {
          source: 'preset',
          presetId: id,
          name: copy?.name ?? id,
          summary: copy?.summary ?? '',
          avoid: copy?.avoid ?? '',
          dims: preset.dims,
        },
        'browse',
      );
    },
    [materialize, presetCopy],
  );

  const pickCandidate = useCallback(
    async (id: string) => {
      const c = candidates.find((x) => x.id === id);
      if (!c) return;
      await materialize(
        { source: 'rolled', presetId: null, name: c.name, summary: c.summary, avoid: c.avoid, dims: c.dims },
        'candidates',
      );
    },
    [candidates, materialize],
  );

  const roll = useCallback(async () => {
    if (!twinId) return;
    const token = latest.next();
    const hadCandidates = candidates.length > 0;
    setError(null);
    setPhase('rolling');
    try {
      const next = await twinApi.rollTwinStyles(twinId, pins, seen);
      if (!latest.isCurrent(token)) return;
      setCandidates(next);
      setSeen((prev) => [...prev, ...next.map((c) => c.dims)]);
      setPhase('candidates');
    } catch (e) {
      if (!latest.isCurrent(token)) return;
      setError(failure('roll', e));
      setPhase(hadCandidates ? 'candidates' : 'browse');
    }
  }, [twinId, pins, seen, candidates.length, latest]);

  const accept = useCallback(async () => {
    if (!twinId || !chosen) return;
    const tones = drafts.filter((d) => selectedChannels.has(d.channel));
    if (tones.length === 0) return;
    const token = latest.next();
    setError(null);
    setPhase('applying');
    try {
      await twinApi.applyTwinStyle(twinId, chosen, tones);
      // The Setup session reads tone rows from the twin slice; refreshing it is
      // what moves the tone cards and the checklist. Its own failure is
      // reported by the slice, and the rows are already written.
      fetchTwinTones(twinId).catch(silentCatch('features/plugins/twin/setup/style:refreshTones'));
      if (!latest.isCurrent(token)) return;
      setChosen(null);
      setDrafts([]);
      setSelected(new Set());
      setPhase('browse');
    } catch (e) {
      if (!latest.isCurrent(token)) return;
      setError(failure('apply', e));
      setPhase('preview');
    }
  }, [twinId, chosen, drafts, selectedChannels, fetchTwinTones, latest]);

  const back = useCallback(() => {
    latest.next();
    setError(null);
    setPhase((current) => {
      if (current === 'preview' || current === 'materializing') return returnTo;
      if (current === 'candidates' || current === 'rolling') return 'browse';
      return current;
    });
  }, [returnTo, latest]);

  const toggleChannel = useCallback((channel: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      phase,
      channels,
      pins,
      togglePin,
      clearPins,
      candidates,
      chosen,
      drafts,
      selectedChannels,
      toggleChannel,
      error,
      pickPreset,
      roll,
      pickCandidate,
      accept,
      back,
      dismissError,
    }),
    [phase, channels, pins, togglePin, clearPins, candidates, chosen, drafts, selectedChannels,
      toggleChannel, error, pickPreset, roll, pickCandidate, accept, back, dismissError],
  );
}
