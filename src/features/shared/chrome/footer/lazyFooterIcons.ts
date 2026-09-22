import { lazyRetry } from '@/lib/lazyRetry';

// Every footer child is its own chunk. The footer is mounted for the whole app
// lifetime, so anything imported eagerly here would sit in the entry bundle;
// splitting per icon keeps the shell tiny and lets each module graph (fleet,
// notepad, companion, workspaces, twin) load only when it is actually shown.

// -- Local chrome icons ------------------------------------------------------
export const CollapseFooterIcon = lazyRetry(() => import('./icons/CollapseFooterIcon'));
export const AccountFooterIcon = lazyRetry(() => import('./icons/AccountFooterIcon'));
export const ThemeFooterIcon = lazyRetry(() => import('./icons/ThemeFooterIcon'));
export const ShortcutsFooterIcon = lazyRetry(() => import('./icons/ShortcutsFooterIcon'));
// Devices SHIPS IN PRODUCTION: pairing must be reachable in a release build.
export const DevicesFooterIcon = lazyRetry(() => import('./icons/DevicesFooterIcon'));
// Network is dev-only diagnostics (exposure / bundles / raw peers).
export const NetworkFooterIcon = lazyRetry(() => import('./icons/NetworkFooterIcon'));
export const TourResumeFooterIcon = lazyRetry(() => import('./icons/TourResumeFooterIcon'));
export const OnboardingReplayFooterIcon = lazyRetry(() => import('./icons/OnboardingReplayFooterIcon'));
// Workspace/project + twin selectors, each hidden while its plugin is disabled.
export const PluginContextSelectors = lazyRetry(() => import('./PluginContextSelectors'));

// -- Shared chrome -----------------------------------------------------------
export const SystemLoadFooterIcon = lazyRetry(() => import('@/features/shared/chrome/SystemLoadFooterIcon'));
export const FooterSectionNav = lazyRetry(() =>
  import('@/features/shared/chrome/FooterSectionNav').then((m) => ({ default: m.FooterSectionNav })),
);

// -- Feature-owned icons -----------------------------------------------------
export const AthenaFooterIcon = lazyRetry(() => import('@/features/companions/athena/AthenaFooterIcon'));
export const RadioFooter = lazyRetry(() => import('@/features/plugins/radio/components/RadioFooter'));
// Notepad SHIPS IN PRODUCTION (unlike the fleet cluster): a scratch note is not dev tooling.
export const NotepadFooterIcon = lazyRetry(() => import('@/features/notepad/NotepadFooterIcon'));
// Fleet status cluster (DEV-only).
export const FleetFooterIcon = lazyRetry(() => import('@/features/plugins/fleet/FleetFooterIcon'));
// Debug-recorder stop pill (DEV-only). Renders nothing unless a recording is
// running, but must be MOUNTED whenever the app is, so the recorder can always
// be stopped even after you leave the grid where it was started.
export const FleetDebugLogFooterPill = lazyRetry(() =>
  import('@/features/plugins/fleet/FleetDebugLogFooterPill').then((m) => ({ default: m.FleetDebugLogFooterPill })),
);
