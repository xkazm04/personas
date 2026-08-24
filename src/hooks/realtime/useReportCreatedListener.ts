import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import { EventName } from '@/lib/eventRegistry';
import { createSingletonListener } from './createSingletonListener';

/**
 * Subscribes to the Tauri 'report-created' channel and invokes a callback
 * for each incoming PersonaReport. Uses a singleton listener internally.
 *
 * Returns `true` once the Tauri listener is confirmed attached.
 */
export const useReportCreatedListener = createSingletonListener<PersonaReport>(
  EventName.REPORT_CREATED,
);
