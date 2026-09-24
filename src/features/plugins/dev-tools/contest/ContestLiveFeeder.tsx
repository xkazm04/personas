// Contest notices for the app-wide live stack, shown even with the Contest
// page and the Monitor closed.
//
// Mounted once at the app root (beside the Notepad layer). On every
// `contest-changed` it refreshes that contest's detail (which also warms the
// page's cache) and compares against what it saw last:
//  - a phase transition INTO `review` → "<title> is ready for review";
//  - a seat newly ending `seat-limit` → one message naming the seat.
// The baseline is seeded from the contest list at mount, so a contest that
// was already in review when the app started is not news. A click on a
// notice opens the Contest tab focused on that contest.
import { useEffect } from 'react';

import type { Translations } from '@/i18n/generated/types';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestChangedPayload } from '@/lib/bindings/ContestChangedPayload';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { pushExternalLiveMessage, registerLiveSource } from '@/features/fleet/monitor/live/liveExternal';
import type { LiveMessage } from '@/features/fleet/monitor/live/liveModel';

import { contestKeyString, focusContest, type ContestKey } from './focus';
import { useContestChanged } from './hooks/contestEvents';
import { contestDetailSlots, contestListSlots, detailKey, refreshContest, refreshContests } from './hooks/contestStore';
import { createLiveFeedMemory, noticesFor, type ContestNotice } from './model/liveFeed';

type Tx = (template: string, vars: Record<string, string | number>) => string;

/** One memory for the app's lifetime: the feeder is mounted once. */
const memory = createLiveFeedMemory();

/** Notice id → the contest it opens. Bounded: the stack itself caps at 30. */
const noticeTargets = new Map<string, ContestKey>();
const NOTICE_TARGETS_CAP = 60;

function remember(id: string, key: ContestKey): void {
  noticeTargets.set(id, key);
  if (noticeTargets.size > NOTICE_TARGETS_CAP) {
    const oldest = noticeTargets.keys().next().value;
    if (oldest !== undefined) noticeTargets.delete(oldest);
  }
}

/** A notice as the live stack's message. Pure — exported for tests. */
export function projectContestNotice(n: ContestNotice, t: Translations, tx: Tx, now = Date.now()): LiveMessage {
  const s = t.plugins.contest;
  const key = contestKeyString(n.summary);
  const ready = n.kind === 'ready';
  return {
    id: ready ? `contest:${key}:ready:${n.summary.updatedAtMs}` : `contest:${key}:seat-limit:${n.seat.seatId}:${now}`,
    teamId: '',
    teamName: s.live_source_label,
    teamColor: '',
    personaId: null,
    personaName: n.summary.projectName,
    personaIcon: null,
    personaColor: null,
    kind: 'event',
    event: ready ? s.live_ready_event : s.live_seat_limit_event,
    tone: '',
    message: ready
      ? tx(s.live_ready, { title: n.summary.title })
      : tx(s.live_seat_limit, { seat: n.seat.spec, title: n.summary.title }),
    at: new Date(now).toISOString(),
    alert: !ready,
    receivedAt: now,
    source: 'contest',
    context: n.summary.title,
  };
}

/** Open the Contest tab on one contest (the notice's body click). */
export function openContest(key: ContestKey): void {
  const sys = useSystemStore.getState();
  sys.setSidebarSection('teams');
  sys.setTeamsTab('contest');
  focusContest(key);
}

/** Seed the phase baseline from the list, once, at mount. */
async function seedFromList(): Promise<void> {
  await refreshContests();
  for (const s of contestListSlots.get('all')?.data ?? []) {
    const k = contestKeyString(s);
    if (!memory.phases.has(k)) memory.phases.set(k, s.phase);
  }
}

export function ContestLiveFeeder() {
  const { t, tx } = useTranslation();

  useEffect(
    () =>
      registerLiveSource('contest', {
        open: (m) => {
          const key = noticeTargets.get(m.id);
          if (key) openContest(key);
        },
      }),
    [],
  );

  useEffect(() => {
    seedFromList().catch(silentCatch('contest:live-feeder-seed'));
  }, []);

  useContestChanged((p: ContestChangedPayload) => {
    const run = async () => {
      await refreshContest(p.projectId, p.contestId);
      const detail = contestDetailSlots.get(detailKey(p.projectId, p.contestId))?.data;
      if (!detail) return;
      for (const n of noticesFor(memory, detail.summary, detail.seats)) {
        const m = projectContestNotice(n, t, tx);
        remember(m.id, { projectId: p.projectId, contestId: p.contestId });
        pushExternalLiveMessage(m);
      }
    };
    run().catch(silentCatch('contest:live-feeder'));
  });

  return null;
}

export default ContestLiveFeeder;
