import { createPortal } from 'react-dom';
import { useSystemStore } from '@/stores/systemStore';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { FooterDivider, FooterSlot } from './FooterSlot';
import {
  AccountFooterIcon, CollapseFooterIcon, AthenaFooterIcon, DevicesFooterIcon,
  FleetDebugLogFooterPill, FleetFooterIcon, FooterSectionNav, NetworkFooterIcon,
  NotepadFooterIcon, OnboardingReplayFooterIcon, PluginContextSelectors, RadioFooter,
  ShortcutsFooterIcon, SystemLoadFooterIcon, ThemeFooterIcon,
  TourResumeFooterIcon,
} from './lazyFooterIcons';

// Desktop footer bar — layout shell only. Every child is a lazily loaded chunk
// (see ./lazyFooterIcons.ts); constants shared with other surfaces live in
// ./footerConstants.ts.

export default function DesktopFooter() {
  const radioEnabled = useSystemStore((s) => s.radioEnabled);
  // Grid mode covers the sidebar, so the footer takes over as the way into
  // other sections (see FooterSectionNav) — and lifts above the z-200 overlay.
  const fleetGridOpen = useSystemStore((s) => s.fleetGridOpen);
  // Both full-screen layers portal to <body> at z-200, so the footer has to
  // climb above either of them to stay reachable — see the stacking-context
  // note under the createPortal call below.
  const notepadOpen = useSystemStore((s) => s.notepadOpen);
  if (IS_MOBILE) return null;

  // PORTAL, not an in-place render — this is load-bearing, not tidiness.
  //
  // `PersonasPage`'s root carries `contain: layout style`. Layout containment
  // makes that element BOTH a stacking context and the containing block for
  // fixed-position descendants, so a footer rendered inside it can only stack
  // against PersonasPage's own children: any `z-[210]` it wears is scoped to a
  // context that itself sits at z-auto. The fleet grid overlay is portaled to
  // <body> at z-200, so it painted over the entire PersonasPage subtree —
  // footer included — no matter how high the footer's z-index went. Portaling
  // the footer to <body> puts the two in the same stacking context, which is
  // what finally makes the z-index mean what it says. It also fixes the
  // footer's upward popovers (theme / account / project picker / fleet), which
  // open INTO the overlay's region and were being painted underneath it.
  //
  // Visually identical either way: the bar is `position: fixed` with explicit
  // insets, so it never depended on its DOM parent for placement.
  return createPortal(
    <div
      role="contentinfo"
      className={`fixed bottom-0 left-0 right-0 ${fleetGridOpen || notepadOpen ? 'z-[210]' : 'z-40'} flex items-center justify-between px-4 h-8 border-t border-primary/10 bg-background`}
    >
      {/* Left cluster: collapse, account, theme, shortcuts, devices, network, companion */}
      <div className="flex items-center gap-1.5">
        <FooterSlot><CollapseFooterIcon /></FooterSlot>
        <FooterDivider />
        <FooterSlot><AccountFooterIcon /></FooterSlot>
        <FooterDivider />
        <FooterSlot><ThemeFooterIcon /></FooterSlot>
        <FooterDivider />
        <FooterSlot><ShortcutsFooterIcon /></FooterSlot>
        <FooterDivider />
        <FooterSlot><DevicesFooterIcon /></FooterSlot>
        {import.meta.env.DEV && (
          <>
            <FooterDivider />
            <FooterSlot><NetworkFooterIcon /></FooterSlot>
          </>
        )}
        {/* Athena companion — docked on the left, immediately right of the
            Network Settings icon. */}
        <FooterDivider />
        <FooterSlot><AthenaFooterIcon /></FooterSlot>
      </div>

      {/* Center cluster, absolute-centered so left/right cluster widths don't
          shift it. In grid mode it carries section navigation — the sidebar is
          covered then, and this is the only way to reach another module without
          first dismissing the grid. That takes precedence over radio: one is
          navigation, the other is a nicety. */}
      {fleetGridOpen ? (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
          <FooterSlot reserve={false}><FooterSectionNav /></FooterSlot>
        </div>
      ) : radioEnabled ? (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
          <FooterSlot reserve={false}><RadioFooter /></FooterSlot>
        </div>
      ) : null}

      {/* Right cluster: notepad, debug-recorder stop + fleet toggle, system
          load, onboarding/tour resume, then the plugin-owned context selectors
          (twin avatar + workspace/project breadcrumb). */}
      <div className="flex items-center gap-1.5">
        <FooterSlot><NotepadFooterIcon /></FooterSlot>
        <FooterDivider />
        {import.meta.env.DEV && (
          <>
            <FooterSlot reserve={false}><FleetDebugLogFooterPill /></FooterSlot>
            <FooterSlot><FleetFooterIcon /></FooterSlot>
            <FooterDivider />
          </>
        )}
        <FooterSlot><SystemLoadFooterIcon /></FooterSlot>
        <FooterDivider />
        <FooterSlot reserve={false}><OnboardingReplayFooterIcon /></FooterSlot>
        <FooterSlot reserve={false}><TourResumeFooterIcon /></FooterSlot>
        <FooterSlot reserve={false}><PluginContextSelectors /></FooterSlot>
      </div>
    </div>,
    document.body,
  );
}
