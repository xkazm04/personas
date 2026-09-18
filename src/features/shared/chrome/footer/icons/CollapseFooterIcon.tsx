import { useState, useEffect, useCallback } from 'react';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { SIDEBAR_TOGGLE_EVENT } from '../footerConstants';

// Sidebar collapse toggle -- fires a custom event consumed by Sidebar.tsx.

export default function CollapseFooterIcon() {
  const { t: tCollapse } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === '1'; } catch { return false; }
  });

  // Stay in sync when Sidebar itself changes localStorage (e.g. from another tab)
  useEffect(() => {
    const handler = () => {
      try { setCollapsed(localStorage.getItem('sidebar-collapsed') === '1'); } catch (err) { silentCatch("features/shared/chrome/footer/icons/CollapseFooterIcon:catch1")(err); }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const handleClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT));
    // Optimistically flip local state
    setCollapsed((c) => !c);
  }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="footer-collapse"
      className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
      title={collapsed ? tCollapse.chrome.expand_sidebar : tCollapse.chrome.collapse_sidebar}
      aria-label={collapsed ? tCollapse.chrome.expand_sidebar : tCollapse.chrome.collapse_sidebar}
    >
      {collapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
    </button>
  );
}
