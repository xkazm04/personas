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
