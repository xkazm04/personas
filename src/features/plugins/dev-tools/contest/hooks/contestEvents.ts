// ONE Tauri listener for `contest-changed`, however many surfaces subscribe
// (the page's hooks and the app-root live feeder). `createSingletonListener`
// owns the lifecycle and buffers an event that lands between mount and the
// listener attaching, so a snapshot fetched on mount plus this stream never
// misses a change in the gap.
import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import type { ContestChangedPayload } from '@/lib/bindings/ContestChangedPayload';
import { EventName } from '@/lib/eventRegistry';

export const useContestChanged = createSingletonListener<ContestChangedPayload>(EventName.CONTEST_CHANGED);
