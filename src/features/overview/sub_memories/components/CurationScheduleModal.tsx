import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Power, Save, Trash2, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import {
  getPersonaCurationSchedule,
  setPersonaCurationSchedule,
  type PersonaCurationSchedule,
} from '@/api/overview/memories';

interface CurationScheduleModalProps {
  personaId: string | null;
  personaName?: string;
  isOpen: boolean;
  onClose: () => void;
}

const CRON_PRESETS = [
  // Translator note: each value is a cron expression — keep verbatim, do not
  // localize. The labelKey is the i18n key for the human-readable name.
  { value: '0 3 * * 0', labelKey: 'curation_schedule.preset_weekly_sunday' },
  { value: '0 3 * * *', labelKey: 'curation_schedule.preset_daily_3am' },
  { value: '0 9 * * 1', labelKey: 'curation_schedule.preset_weekly_monday' },
  { value: '0 0 1 * *', labelKey: 'curation_schedule.preset_monthly' },
] as const;

export default function CurationScheduleModal({
  personaId,
  personaName,
  isOpen,
  onClose,
}: CurationScheduleModalProps) {
  const { t } = useTranslation();
  const [schedule, setSchedule] = useState<PersonaCurationSchedule | null>(null);
  const [cronInput, setCronInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing schedule on open.
  useEffect(() => {
    if (!isOpen || !personaId) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getPersonaCurationSchedule(personaId)
      .then((row) => {
        if (cancelled) return;
        setSchedule(row);
        setCronInput(row?.cronExpr ?? '');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, personaId]);

  const presets = useMemo(
    () =>
      CRON_PRESETS.map((p) => ({
        value: p.value,
        // Indirect string lookup — keys are guaranteed to exist in en.json.
        label:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (t.overview.memories as any)[p.labelKey.replace('curation_schedule.', '')] ?? p.value,
      })),
    [t],
  );

  const handleSave = async () => {
    if (!personaId) return;
    setIsSaving(true);
    setError(null);
    try {
      const row = await setPersonaCurationSchedule(personaId, cronInput.trim());
      setSchedule(row);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisable = async () => {
    if (!personaId) return;
    setIsSaving(true);
    setError(null);
    try {
      await setPersonaCurationSchedule(personaId, '');
      setSchedule(null);
      setCronInput('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !personaId) return null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="curation-schedule-title"
      size="md"
      panelClassName="bg-background border border-primary/20 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col max-h-[80vh]"
    >
      <div className="flex items-start justify-between p-4 border-b border-primary/10 flex-shrink-0">
        <div className="flex-1 min-w-0 pr-4">
          <h3
            id="curation-schedule-title"
            className="typo-heading text-foreground/95 flex items-center gap-2"
          >
            <CalendarClock className="w-4 h-4 text-cyan-400" />
            {t.overview.memories.curation_schedule_title}
          </h3>
          {personaName && (
            <p className="typo-body text-foreground mt-1">{personaName}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground/95 transition-colors"
          aria-label={t.common.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <p className="typo-body text-foreground">
          {t.overview.memories.curation_schedule_description}
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center p-6">
            <LoadingSpinner size="sm" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label
                htmlFor="curation-cron-input"
                className="typo-heading text-foreground/95"
              >
                {t.overview.memories.curation_schedule_cron_label}
              </label>
              <input
                id="curation-cron-input"
                type="text"
                value={cronInput}
                onChange={(e) => setCronInput(e.target.value)}
                placeholder="0 3 * * 0"
                className="w-full px-3 py-2 typo-code font-mono rounded-card bg-secondary/30 border border-primary/15 text-foreground focus:outline-none focus:border-primary/40"
                spellCheck={false}
              />
              <p className="typo-caption text-foreground">
                {t.overview.memories.curation_schedule_cron_hint}
              </p>
            </div>

            <div className="space-y-2">
              <span className="typo-caption text-foreground">
                {t.overview.memories.curation_schedule_presets_label}
              </span>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setCronInput(p.value)}
                    className="px-2 py-1 typo-caption rounded-card bg-secondary/30 hover:bg-secondary/50 border border-primary/15 text-foreground transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {schedule?.lastCurationAt && (
              <div className="p-3 rounded-card bg-emerald-500/10 border border-emerald-500/20">
                <p className="typo-caption text-emerald-300">
                  {t.overview.memories.curation_schedule_last_run_label}
                </p>
                <p className="typo-body text-foreground font-mono">
                  {schedule.lastCurationAt}
                </p>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-card bg-red-500/10 border border-red-500/20">
                <p className="typo-body text-red-300">{error}</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 p-4 border-t border-primary/10 flex-shrink-0">
        {schedule ? (
          <button
            onClick={handleDisable}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 typo-body rounded-card bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-300 transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.overview.memories.curation_schedule_disable}
          </button>
        ) : (
          <span className="typo-caption text-foreground flex items-center gap-1.5">
            <Power className="w-3.5 h-3.5" />
            {t.overview.memories.curation_schedule_disabled_state}
          </span>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 typo-body rounded-card bg-secondary/30 hover:bg-secondary/50 border border-primary/15 text-foreground transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !cronInput.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 typo-body rounded-card bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/25 text-cyan-300 transition-colors disabled:opacity-40"
          >
            {isSaving ? <LoadingSpinner size="sm" /> : <Save className="w-3.5 h-3.5" />}
            {t.overview.memories.curation_schedule_save}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
