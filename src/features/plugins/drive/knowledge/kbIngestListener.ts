/**
 * The KB ingest progress stream, attached the way `snapshot-plus-stream`
 * prescribes rather than the way the rest of this drawer historically did.
 *
 * `useTypedTauriEvent` attaches a raw subscription whose pre-attach
 * window is neither buffered nor counted: every payload emitted between mount
 * and the listener resolving is gone, silently. For a progress stream that
 * window is exactly the job's first moments - the part the operator is looking
 * at while wondering whether anything started.
 *
 * `createSingletonListener` is the primitive the golden path names for this: it
 * buffers up to 50 early arrivals, counts what it had to drop beyond that, and
 * fans one Tauri subscription out to every consumer, so two surfaces watching
 * the same ingest do not open two listeners.
 *
 * Progress only. The COMPLETE subscription stays on the typed hook because a
 * terminal event cannot be raced in the same way - the drawer re-reads the KB
 * on mount, so a missed completion still settles into the right count.
 */

import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import { EventName, type KbIngestProgressPayload } from '@/lib/eventRegistry';

export const useKbIngestProgress = createSingletonListener<KbIngestProgressPayload>(
  EventName.KB_INGEST_PROGRESS,
);
