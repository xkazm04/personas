import type { ReactNode } from 'react';
import type { GlyphDimension } from '@/features/shared/glyph';
import { TaskDimEditor, TriggerDimEditor } from './TaskTriggerEditors';
import { ConnectorDimEditor, MessageDimEditor, EventDimEditor } from './RoutingEditors';
import { ReviewDimEditor, MemoryDimEditor, ErrorDimEditor } from './PolicyEditors';
import type { CharterDimEditorProps } from './dimEditorShell';

/**
 * Resolve the EDITABLE body `SigilEditModal` renders for one glyph dimension
 * of one charter. One body per dimension, each mapped to the charter columns
 * that actually carry that dimension:
 *
 *   task      -> `procedure` + `outcomes`
 *   trigger   -> `cadence` (+ `budgetMonthlyUsd`)
 *   connector -> `connectors` allowlist
 *   message   -> `spec.notificationChannels`
 *   review    -> `approvalGates` + `spec.reviewPolicy`
 *   memory    -> `spec.memoryPolicy`
 *   event     -> `spec.eventSubscriptions`
 *   error     -> `spec.errorPolicy` + `spec.errorHandling`
 *
 * Replaces the read-only `shared/glyph/persona-layout/sigilEditBodies.tsx`
 * resolver, whose bodies were placeholders pending "Phase 3b". That module
 * stays for the design-context surfaces; charters get real editors.
 */
export function resolveCharterSigilBody(
  dim: GlyphDimension,
  props: CharterDimEditorProps,
): ReactNode {
  switch (dim) {
    case 'task':
      return <TaskDimEditor {...props} />;
    case 'trigger':
      return <TriggerDimEditor {...props} />;
    case 'connector':
      return <ConnectorDimEditor {...props} />;
    case 'message':
      return <MessageDimEditor {...props} />;
    case 'review':
      return <ReviewDimEditor {...props} />;
    case 'memory':
      return <MemoryDimEditor {...props} />;
    case 'event':
      return <EventDimEditor {...props} />;
    case 'error':
      return <ErrorDimEditor {...props} />;
    default:
      return null;
  }
}
