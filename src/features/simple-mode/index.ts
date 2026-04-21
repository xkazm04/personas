/**
 * Simple-mode module entry. Exposes the top-level `SimpleHomePage` component
 * that takes over the viewport when `viewMode === TIERS.STARTER`.
 *
 * Variant shells (Mosaic / Console / Inbox) are lazy-loaded from inside
 * SimpleHomePage; consumers should only import the default export here.
 *
 * Also re-exports the unified inbox selector + types so Phases 07-09 and
 * any future consumer can import from `@/features/simple-mode` directly.
 */
export { default } from './SimpleHomePage';
export { default as SimpleHomePage } from './SimpleHomePage';

export { useUnifiedInbox } from './hooks/useUnifiedInbox';
export { normalizeSeverity } from './types';
export type { InboxKind, Severity, UnifiedInboxItem } from './types';

// Phase 16 Topic B: the output adapter + classifier are exported from the
// feature barrel so tests and future consumers can reach them without drilling
// into the adapters directory.
export { adaptOutput, isMessageOutput } from './hooks/adapters/outputAdapter';

export { useIllustration, resolveIllustration, CATEGORIES } from './hooks/useIllustration';
export type { IllustrationCategory, ResolvedIllustration } from './hooks/useIllustration';

export { useSimpleSummary } from './hooks/useSimpleSummary';
export type { SimpleSummary } from './hooks/useSimpleSummary';

export { useInboxActions } from './hooks/useInboxActions';
export type {
  InboxActions,
  InboxActionDescriptor,
  InboxActionLabelKey,
  ActionTone,
} from './hooks/useInboxActions';

export { ModeComparisonCard } from './components/ModeComparisonCard';
export type { ModeComparisonCardProps } from './components/ModeComparisonCard';

export { GraduateToPowerModal } from './components/GraduateToPowerModal';
export type { GraduateToPowerModalProps } from './components/GraduateToPowerModal';
