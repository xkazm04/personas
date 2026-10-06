import { Suspense, type ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore, type ThemeId } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { LoadLevel } from '@/features/shared/components/layout/systemLoad';
import { useSystemLoad } from '../../SystemLoadFooterIcon';
import { ThemeSwatchGrid } from '../icons/ThemeSwatchGrid';

// PROTOTYPE (footer variants): pieces every variant draws the same way.

/** Load bands as status tokens (the baseline used raw emerald/amber/red). */
export const LOAD_TONE: Record<LoadLevel, { text: string; bg: string }> = {
  green: { text: 'text-status-success', bg: 'bg-status-success' },
  amber: { text: 'text-status-warning', bg: 'bg-status-warning' },
  red: { text: 'text-status-error', bg: 'bg-status-error' },
};

const HEADROOM_KEY = { green: 'headroom_green', amber: 'headroom_amber', red: 'headroom_red' } as const;

/** Host load plus the sentence the tooltip reads. */
export function useLoadReadout() {
  const { t, tx } = useTranslation();
  const load = useSystemLoad();
  const headroom = load.ready ? t.chrome.system_load[HEADROOM_KEY[load.level]] : t.chrome.system_load.measuring;
  const freeGb = load.metrics ? (Number(load.metrics.memAvailableMb) / 1024).toFixed(1) : '-';
  const cpuLine = tx(t.chrome.system_load.cpu, { pct: Math.round(load.cpu) });
  const ramLine = tx(t.chrome.system_load.ram, { pct: Math.round(load.memUsedPct), free: freeGb });
  const tooltip = load.ready ? `${cpuLine} · ${ramLine}. ${headroom}` : headroom;
  return { ...load, tone: LOAD_TONE[load.level], headroom, cpuLine, tooltip, label: t.chrome.system_load.label };
}

/** Suspense boundary for a feature-owned footer child (fleet, Athena, twin, project). */
export function Hosted({ children, w = 'w-9' }: { children: ReactNode; w?: string }) {
  return <Suspense fallback={<span className={`${w} h-9`} aria-hidden="true" />}>{children}</Suspense>;
}

function PopoverShell({ children, align = 'left', w = 'w-56' }: { children: ReactNode; align?: 'left' | 'right'; w?: string }) {
  return (
    <div className={`animate-fade-slide-in absolute bottom-full ${align === 'left' ? 'left-0' : 'right-0'} mb-2 ${w} rounded-card border border-primary/15 bg-background shadow-elevation-3 p-3 z-50`}>
      {children}
    </div>
  );
}

export function ThemePopover({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const pick = (id: ThemeId) => { setTheme(id); onDone(); };
  return (
    <PopoverShell w="w-64">
      <p className="typo-label mb-2">{t.chrome.dark}</p>
      <ThemeSwatchGrid light={false} activeId={themeId} onPick={pick} />
      <div className="border-t border-primary/10 mt-3 pt-3">
        <p className="typo-label mb-2">{t.chrome.light}</p>
        <ThemeSwatchGrid light activeId={themeId} onPick={pick} />
      </div>
    </PopoverShell>
  );
}

export function AccountPopover({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  return (
    <PopoverShell>
      <div className="pb-2 mb-2 border-b border-primary/10 min-w-0">
        <p className="typo-body font-medium text-foreground truncate">{user?.display_name ?? t.chrome.signed_in}</p>
        {user?.email && <p className="typo-caption truncate">{user.email}</p>}
      </div>
      <Button variant="ghost" size="sm" block icon={<LogOut className="w-4 h-4" />}
        onClick={() => { logout(); onDone(); }}>
        {t.chrome.sign_out}
      </Button>
    </PopoverShell>
  );
}

/** Auth state the account control needs, plus its accessible name. */
export function useAccount() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const name = isAuthenticated ? (user?.display_name ?? user?.email ?? t.chrome.signed_in) : t.chrome.sign_in_google;
  const firstName = user?.display_name?.split(' ')[0] ?? null;
  return { user, isAuthenticated, isLoading, loginWithGoogle, name, firstName };
}
