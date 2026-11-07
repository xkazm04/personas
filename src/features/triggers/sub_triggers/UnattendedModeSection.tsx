import { useState } from 'react';
import { Zap, FlaskConical, ShieldCheck } from 'lucide-react';
import { setTriggerUnattendedMode, type UnattendedMode } from '@/api/pipeline/triggers';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaTrigger } from '@/lib/types/types';

import { PressSurface } from '@/features/shared/components/buttons';
// The destructive-action gate intercepts triggers that fire a run autonomously
// on external input: SCHEDULER-fired (schedule + polling, held at scheduler
// tick) and WEBHOOK (held at dispatch — UAT F-MAJOR-11, an alert/ticket
// webhook was the one external-ingress type left ungated). The control shows
// only for those, where it has real effect. `event_listener` triggers react to
// internal persona events (chain steps) and are not gated here — the run gate
// would need subscription→trigger resolution that isn't plumbed, and surfacing
// a control the backend doesn't honor would be a worse (lying) signal.
const GATED_TYPES = new Set(['schedule', 'polling', 'webhook']);

/**
 * Per-trigger "what happens when this fires unattended" control: run normally
 * (auto), run-but-suppress-outbound (dry_run), or hold for approval (approval).
 * Addresses UAT F-NO-DESTRUCTIVE-GATE — a write-capable cron no longer has to
 * fire blind at 3am.
 */
export function UnattendedModeSection({ trigger }: { trigger: PersonaTrigger }) {
  const { t } = useTranslation();
  const u = t.triggers.unattended;
  const [mode, setMode] = useState<UnattendedMode>(
    (trigger.unattended_mode as UnattendedMode) ?? 'auto',
  );
  const [saving, setSaving] = useState(false);

  if (!GATED_TYPES.has(trigger.trigger_type)) return null;

  const options: {
    id: UnattendedMode;
    Icon: typeof Zap;
    label: string;
    desc: string;
    sel: string;
    iconCls: string;
  }[] = [
    { id: 'auto', Icon: Zap, label: u.auto, desc: u.auto_desc, sel: 'border-primary/40 bg-surface-1', iconCls: 'text-primary' },
    { id: 'dry_run', Icon: FlaskConical, label: u.dry_run, desc: u.dry_run_desc, sel: 'border-status-warning/40 bg-status-warning/10', iconCls: 'text-status-warning' },
    { id: 'approval', Icon: ShieldCheck, label: u.approval, desc: u.approval_desc, sel: 'border-status-success/40 bg-status-success/10', iconCls: 'text-status-success' },
  ];

  const choose = async (next: UnattendedMode) => {
    if (next === mode || saving) return;
    const prev = mode;
    setMode(next);
    setSaving(true);
    try {
      await setTriggerUnattendedMode(trigger.id, trigger.persona_id, next);
    } catch (e) {
      setMode(prev);
      toastCatch('UnattendedModeSection.set')(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="trigger-unattended-mode">
      <div className="typo-section-title">{u.title}</div>
      <p className="typo-caption text-ink-2">{u.subtitle}</p>
      <div role="radiogroup" aria-label={u.title} className="grid gap-1.5">
        {options.map((o) => {
          const selected = mode === o.id;
          return (
            <PressSurface key={o.id} role="radio" aria-checked={selected} aria-pressed={undefined} selected={selected} disabled={saving} onPress={() => choose(o.id)} className="flex items-start gap-2 px-3 py-2 rounded-card border border-hair">
              <o.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${selected ? o.iconCls : 'text-ink-1'}`} />
              <div className="min-w-0">
                <div className="typo-body text-ink-1">{o.label}</div>
                <div className="typo-caption text-ink-2">{o.desc}</div>
              </div>
            </PressSurface>
          );
        })}
      </div>
    </div>
  );
}
