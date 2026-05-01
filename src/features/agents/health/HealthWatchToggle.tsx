import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { managementFetch } from '@/api/system/managementApiAuth';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

export function HealthWatchToggle() {
  const { t } = useTranslation();
  const persona = useAgentStore((s) => s.selectedPersona);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!persona) return;
    // Cancellation guard: managementFetch resolves asynchronously, and a
    // persona switch (or unmount) before resolve would otherwise commit
    // persona A's enabled flag onto persona B's view, or set state on an
    // unmounted component (React warns; semantics drift either way).
    let cancelled = false;
    managementFetch(`/api/settings/health-watch/${persona.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return;
        if (d?.data?.enabled !== undefined) setEnabled(d.data.enabled);
      })
      .catch(silentCatch('HealthWatchToggle:load'));
    return () => { cancelled = true; };
  }, [persona]);

  const toggle = async () => {
    if (!persona) return;
    setLoading(true);
    try {
      const r = await managementFetch(`/api/settings/health-watch/${persona.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled, interval_hours: 6, error_threshold: 30 }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setEnabled(!enabled);
    } catch (err) {
      toastCatch('HealthWatchToggle:save', t.agents.settings_status.failed_health_watch)(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-end">
      <button
        data-testid="health-watch-toggle"
        onClick={toggle}
        disabled={loading || !persona}
        aria-pressed={enabled}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 typo-caption font-medium rounded-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          enabled
            ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
            : 'text-foreground hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
        }`}
        title={enabled ? t.agents.settings_status.health_watch_active : t.agents.settings_status.health_watch_enable}
      >
        <Eye className={`w-3 h-3 ${enabled ? 'text-cyan-400' : ''}`} aria-hidden="true" />
        {t.agents.settings_status.health_watch}
        <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-cyan-400' : 'bg-muted-foreground/30'}`} aria-hidden="true" />
      </button>
    </div>
  );
}
