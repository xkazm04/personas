/**
 * The open proposals the twin's writing samples produced (spark
 * twin-portable-blueprint), for the Hub's queue lane.
 *
 * A sample is analysed in the background; each analysis files proposals
 * (an exemplar, a voice rule, a do/don't, a length hint, style dims) that
 * change NOTHING until the user keeps or dismisses them here. The facts a
 * sample yields are not proposals: they arrive as pending memories (channel
 * `sample`) through the feed the queue already reviews.
 *
 * Loaded with the twin's samples so a card can say where its sample came
 * from, refetched on `twin-sample-updated`. The snapshot is taken AFTER the
 * listener is attached (golden path snapshot-plus-stream): an analysis that
 * lands between a first load and the attach would otherwise be missed until
 * the next event, and the event carries no rows to replay.
 *
 * A failed load is quiet (the lane simply shows no proposals; the feed's own
 * error banner is for the feed); a failed keep / dismiss is answered inline on
 * the card the user pressed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { sampleList, sampleProposals, sampleResolve } from '@/api/twin/twinSample';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';
import type { TwinSample } from '@/lib/bindings/TwinSample';
import type { TwinSampleProposal } from '@/lib/bindings/TwinSampleProposal';
import { describeTwinError } from '../card/cardErrors';
import type { HubSampleProposal, HubSampleProposals } from './hubContract';

interface Loaded {
  proposals: TwinSampleProposal[];
  samples: TwinSample[];
}

const EMPTY: Loaded = { proposals: [], samples: [] };

export function useSampleProposals(twinId: string | null): HubSampleProposals {
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [latestWins] = useState(createLatestWins);

  const refresh = useCallback(async () => {
    const gen = latestWins.next();
    if (!twinId) {
      setLoaded(EMPTY);
      return;
    }
    try {
      const [proposals, samples] = await Promise.all([sampleProposals(twinId, 'open'), sampleList(twinId)]);
      if (!latestWins.isCurrent(gen)) return;
      setLoaded({ proposals: proposals ?? [], samples: samples ?? [] });
    } catch (err) {
      // Until the sample backend lands the commands reject; the lane shows the
      // memories it always showed and no proposals, never a toast per load.
      silentCatch('twin:hub:sampleProposals')(err);
      if (latestWins.isCurrent(gen)) setLoaded(EMPTY);
    }
  }, [twinId, latestWins]);

  // Attach first, then take the snapshot: every analysis that settles after
  // the attach refetches, and everything before it is in the snapshot.
  useEffect(() => {
    setErrors({});
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    typedListen(EventName.TWIN_SAMPLE_UPDATED, (payload) => {
      if (!cancelled && payload.twinId === twinId) void refresh();
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(silentCatch('twin:hub:sampleUpdated'))
      .finally(() => {
        // A failed attach still loads once: stale-until-revisit beats empty.
        if (!cancelled) void refresh();
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [twinId, refresh]);

  const resolve = useCallback(
    async (proposalId: string, verdict: 'accept' | 'dismiss', editedValue?: string | null) => {
      setBusyId(proposalId);
      setErrors(({ [proposalId]: _cleared, ...rest }) => rest);
      try {
        await sampleResolve(proposalId, verdict, editedValue ?? null);
        // Resolved means no longer open: the card leaves the lane.
        setLoaded((prev) => ({ ...prev, proposals: prev.proposals.filter((p) => p.id !== proposalId) }));
      } catch (err) {
        silentCatch('twin:hub:sampleResolve')(err);
        setErrors((prev) => ({ ...prev, [proposalId]: describeTwinError(err) }));
      } finally {
        setBusyId((cur) => (cur === proposalId ? null : cur));
      }
    },
    [],
  );

  const items = useMemo<HubSampleProposal[]>(() => {
    const byId = new Map(loaded.samples.map((s) => [s.id, s]));
    return loaded.proposals
      .filter((p) => p.status === 'open')
      .map((proposal) => ({ proposal, sample: byId.get(proposal.sampleId) ?? null }));
  }, [loaded]);

  return { items, busyId, errors, resolve, refresh };
}
