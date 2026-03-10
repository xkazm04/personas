import { AnimatePresence } from 'framer-motion';
import type { TimeRange, PlaybackSpeed, TimelineReplayState } from '@/hooks/realtime/useTimelineReplay';
import { ReplayEntryBar } from './ReplayEntryBar';
import { ActiveTimelineBar } from './ActiveTimelineBar';

interface Props extends TimelineReplayState {
  onEnterReplay: (range: TimeRange) => Promise<void>;
  onExitReplay: () => void;
  onTogglePlay: () => void;
  onSetSpeed: (s: PlaybackSpeed) => void;
  onSeek: (fraction: number) => void;
}

export default function TimelinePlayer(props: Props) {
  return (
    <AnimatePresence mode="wait">
      {props.active ? (
        <ActiveTimelineBar key="active" {...props} />
      ) : (
        <ReplayEntryBar
          key="entry"
          loading={props.loading}
          onEnterReplay={props.onEnterReplay}
        />
      )}
    </AnimatePresence>
  );
}
