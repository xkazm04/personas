import type { ComponentType, MouseEvent, ReactNode } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import {
  AccountGlyph, KeycapGlyph, NetworkGlyph, NotepadGlyph, ReplayGlyph, SidebarGlyph,
  ThemeGlyph, TourGlyph, type GlyphWeight,
} from './FooterGlyphs';
import {
  useActiveTheme, useNotepadToggle, useOnboardingReplay, usePopover, useShortcutMode,
  useSidebarCollapse, useTourResume,
} from './footerHooks';
import { AccountPopover, ThemePopover, useAccount } from './FooterShared';

// PROTOTYPE (footer variants): each footer control written ONCE against a
// `Key` renderer. A variant supplies the Key (its shape, size, state marks)
// and the glyph weight; the control supplies meaning (glyph, label, state, an
// optional short value text). Three variants, one set of semantics.

/** `signal` is the control's state mark: `on` = engaged, `ok` = healthy, `dev` = dev-only. */
export type KeySignal = 'on' | 'ok' | 'dev' | null;

export interface KeyProps {
  label: string;
  testId: string;
  glyph: ReactNode;
  /** Short value text (theme name, first name, 3/7). A variant may ignore it. */
  text?: string | null;
  signal?: KeySignal;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  onPointerEnter?: () => void;
}

export interface Skin {
  Key: ComponentType<KeyProps>;
  weight: GlyphWeight;
  /** Glyph box, e.g. `w-6 h-6`. */
  g: string;
}

export function SidebarControl({ skin }: { skin: Skin }) {
  const { t } = useTranslation();
  const { collapsed, toggle } = useSidebarCollapse();
  const { Key } = skin;
  return (
    <Key testId="footer-collapse" onClick={toggle}
      label={collapsed ? t.chrome.expand_sidebar : t.chrome.collapse_sidebar}
      glyph={<SidebarGlyph collapsed={collapsed} weight={skin.weight} className={skin.g} />} />
  );
}

export function AccountControl({ skin }: { skin: Skin }) {
  const a = useAccount();
  const pop = usePopover();
  const { Key } = skin;
  const glyph = a.isAuthenticated && a.user?.avatar_url
    ? <img src={a.user.avatar_url} alt="" className={`${skin.g} rounded-full ring-2 ring-status-success/50`} />
    : <AccountGlyph weight={skin.weight} className={skin.g} />;
  return (
    <div ref={pop.ref} className="relative">
      <Key testId="footer-account" label={a.name} glyph={glyph} disabled={a.isLoading}
        text={a.isAuthenticated ? a.firstName : null}
        signal={a.isAuthenticated ? 'ok' : null} pressed={pop.open}
        onClick={() => (a.isAuthenticated ? pop.setOpen((o) => !o) : a.loginWithGoogle())} />
      {pop.open && a.isAuthenticated && <AccountPopover onDone={pop.close} />}
    </div>
  );
}

export function ThemeControl({ skin }: { skin: Skin }) {
  const theme = useActiveTheme();
  const pop = usePopover();
  const { Key } = skin;
  return (
    <div ref={pop.ref} className="relative">
      <Key testId="footer-theme" label={`Theme: ${theme.label}`} text={theme.label} pressed={pop.open}
        onClick={() => pop.setOpen((o) => !o)}
        glyph={<ThemeGlyph swatch={theme.swatch} weight={skin.weight} className={skin.g} />} />
      {pop.open && <ThemePopover onDone={pop.close} />}
    </div>
  );
}

export function ShortcutsControl({ skin }: { skin: Skin }) {
  const { t } = useTranslation();
  const mode = useShortcutMode();
  const { Key } = skin;
  return (
    <Key testId="footer-shortcuts" label={t.chrome.shortcuts.mode_toggle_title}
      signal={mode.active ? 'on' : null} pressed={mode.active}
      onClick={mode.toggle} onContextMenu={mode.openSheet}
      glyph={<KeycapGlyph weight={skin.weight} className={skin.g} />} />
  );
}

export function NetworkControl({ skin }: { skin: Skin }) {
  const { t } = useTranslation();
  const setSection = useSystemStore((s) => s.setSidebarSection);
  const setTab = useSystemStore((s) => s.setSettingsTab);
  const { Key } = skin;
  return (
    <Key testId="footer-network" label={t.chrome.network_settings} signal="dev"
      onClick={() => { setSection('settings'); setTab('network'); }}
      glyph={<NetworkGlyph weight={skin.weight} className={skin.g} />} />
  );
}

export function NotepadControl({ skin }: { skin: Skin }) {
  const { t } = useTranslation();
  const pad = useNotepadToggle();
  const { Key } = skin;
  return (
    <Key testId="footer-notepad" label={pad.open ? t.notepad.footer_close : t.notepad.footer_open}
      signal={pad.open ? 'on' : null} pressed={pad.open}
      onClick={pad.toggle} onPointerEnter={pad.prefetch}
      glyph={<NotepadGlyph weight={skin.weight} className={skin.g} />} />
  );
}

/** Resume-tour, or resume/replay setup: the footer's one way back into guidance. */
export function GuidanceControl({ skin }: { skin: Skin }) {
  const { t, tx } = useTranslation();
  const tour = useTourResume();
  const onboarding = useOnboardingReplay();
  const { Key } = skin;
  if (tour) {
    return (
      <Key testId="footer-resume-tour" onClick={tour.resume} signal="on"
        label={tx(t.onboarding.resume_tour, { completed: tour.done, total: tour.total })}
        text={`${tour.done}/${tour.total}`}
        glyph={<TourGlyph weight={skin.weight} className={skin.g} />} />
    );
  }
  if (onboarding) {
    const label = onboarding.canResume ? t.onboarding.resume_setup : t.onboarding.replay_setup;
    return (
      <Key testId="footer-replay-onboarding" onClick={onboarding.run} label={label} text={label}
        glyph={<ReplayGlyph weight={skin.weight} className={skin.g} />} />
    );
  }
  return null;
}
