import { useState } from 'react';
import { Zap, FlaskConical, ShieldCheck } from 'lucide-react';
import { setTriggerUnattendedMode, type UnattendedMode } from '@/api/pipeline/triggers';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaTrigger } from '@/lib/types/types';

// The destructive-action gate (UAT P5) intercepts only SCHEDULER-fired triggers
// — schedule + polling — so the control is shown only for those (where it has
// effect). Event-driven triggers react to persona events, a different path.
const GATED_TYPES = new Set(['schedule', 'polling']);

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
    { id: 'auto', Icon: Zap, label: u.auto, desc: u.auto_desc, sel: 'border-primary/40 bg-primary/10', iconCls: 'text-primary' },
    { id: 'dry_run', Icon: FlaskConical, label: u.dry_run, desc: u.dry_run_desc, sel: 'border-amber-500/40 bg-amber-500/10', iconCls: 'text-amber-400' },
    { id: 'approval', Icon: ShieldCheck, label: u.approval, desc: u.approval_desc, sel: 'border-emerald-500/40 bg-emerald-500/10', iconCls: 'text-emerald-400' },
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
      <div className="typo-section-title text-foreground">{u.title}</div>
      <p className="typo-caption text-foreground">{u.subtitle}</p>
      <div role="radiogroup" aria-label={u.title} className="grid gap-1.5">
        {options.map((o) => {
          const selected = mode === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving}
              onClick={() => choose(o.id)}
              className={`flex items-start gap-2 px-3 py-2 rounded-card border text-left transition-colors disabled:opacity-60 ${
                selected ? o.sel : 'border-primary/10 hover:bg-secondary/30'
              }`}
            >
              <o.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${selected ? o.iconCls : 'text-foreground'}`} />
              <div className="min-w-0">
                <div className="typo-body font-medium text-foreground">{o.label}</div>
                <div className="typo-caption text-foreground">{o.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
