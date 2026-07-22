import { ShieldCheck, MessageSquare, Activity, FileText, type LucideIcon } from 'lucide-react';

import type { UnifiedInboxItem } from '../types';

/**
 * Map an inbox item kind to its lucide icon. Single canonical mapping; the
 * cockpit DecisionDrawer and DecisionsPanelWidget both read from here so a
 * new inbox kind or an icon swap happens in one place instead of drifting
 * between the row glyph and its opened drawer badge.
 */
export function inboxKindIcon(kind: UnifiedInboxItem['kind']): LucideIcon {
  switch (kind) {
    case 'approval':
      return ShieldCheck;
    case 'message':
      return MessageSquare;
    case 'health':
      return Activity;
    case 'output':
      return FileText;
  }
}
