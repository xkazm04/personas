import { useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { obsidianAvailable } from '@/api/obsidianBrain';
import {
  getDirectorBrainEnabled,
  setDirectorBrainEnabled,
  runDirectorBatch,
  listDirectorVerdicts,
  type DirectorVerdictRow,
} from '@/api/director';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { AsyncButton } from '@/features/shared/components/buttons/AsyncButton';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Unified Director management surface on the All Agents page. Replaces the
 * v1 bare brain toggle with: scope summary (starred personas count), Brain
 * long-term-memory toggle (gated on a configured vault), a "Run review now"
 * batch trigger, and a latest-verdicts feed. Hidden until the persona store
 * has loaded and the Director persona has been seeded.
 *
 * The Director is the cross-persona coach; this panel is the single place
 * users see its state, trigger a sweep, and adjust its memory wiring — so
 * Director controls stop being scattered across the activity list + a lone
 * toggle.
 */
export function DirectorPanel() {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const director = useMemo(
    () => personas.find((p) => p.trust_origin === 'system' && p.name === 'Director'),
    [personas],
  );
  const starredCount = useMemo(
    () => personas.filter((p) => p.starred && p.trust_origin !== 'system').length,
    [personas],
  );
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [brainEnabled, setBrainEnabledLocal] = useState(false);
  const [verdicts, setVerdicts] = useState<DirectorVerdictRow[]>([]);
  const [ready, setReady] = useState(false);

  const refreshVerdicts = () => {
    listDirectorVerdicts()
      .then((rows) => setVerdicts(rows.slice(0, 4)))
      .catch(silentCatch('DirectorPanel:verdicts'));
  };

  useEffect(() => {
    let active = true;
    Promise.all([obsidianAvailable(), getDirectorBrainEnabled(), listDirectorVerdicts()])
      .then(([avail, on, vs]) => {
        if (!active) return;
        setVaultConfigured(avail.vaultConfigured);
        setBrainEnabledLocal(on);
        setVerdicts(vs.slice(0, 4));
        setReady(true);
      })
      .catch(silentCatch('DirectorPanel:init'));
    return () => {
      active = false;
    };
  }, []);

  if (!ready || !director) return null;

  const toggleBrain = () => {
    const next = !brainEnabled;
    setBrainEnabledLocal(next);
    setDirectorBrainEnabled(next).catch((e) => {
      setBrainEnabledLocal(!next);
      silentCatch('DirectorPanel:setBrain')(e);
    });
  };

  const runBatch = async () => {
    try {
      await runDirectorBatch();
    } finally {
      refreshVerdicts();
    }
  };

  const lastVerdictAt = verdicts[0]?.createdAt ?? null;

  return (
    <div className="mx-3 mt-2 rounded-card border border-violet-500/20 bg-violet-500/[0.04] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-violet-500/15">
        <div
          className="icon-frame icon-frame-pop bg-violet-500/10 border border-violet-500/20 flex-shrink-0"
        >
          <PersonaIcon
            icon={director.icon}
            color={director.color}
            size="w-4 h-4"
            framed
            frameSize="lg"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="typo-heading text-foreground/90">{t.director.panel_title}</div>
          <div className="typo-caption text-foreground/60">
            {starredCount > 0
              ? tx(t.director.scope_summary, { count: starredCount })
              : t.director.scope_empty}
            {lastVerdictAt && (
              <>
                {' · '}
                <span className="text-foreground/55">{t.director.last_review}</span>{' '}
                <RelativeTime ts={lastVerdictAt} />
              </>
            )}
          </div>
        </div>
        <AsyncButton
          variant="primary"
          size="sm"
          onClick={runBatch}
          disabled={starredCount === 0}
          title={starredCount === 0 ? t.director.no_scope_hint : t.director.run_batch_hint}
          data-testid="director-run-batch"
        >
          {t.director.run_batch}
        </AsyncButton>
      </div>

      {/* Body: brain toggle + recent verdicts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
        {/* Brain */}
        <div className="min-w-0">
          <div className="typo-body font-medium text-foreground/85 mb-1.5">
            {t.director.brain_title}
          </div>
          {vaultConfigured ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-card bg-secondary/30 border border-primary/10">
              <p className="typo-caption text-foreground/70 min-w-0">
                {t.director.brain_subtitle}
              </p>
              <AccessibleToggle
                checked={brainEnabled}
                onChange={toggleBrain}
                label={t.director.brain_title}
                data-testid="director-brain-toggle"
              />
            </div>
          ) : (
            <p className="typo-caption text-foreground/55 italic px-1">
              {t.director.brain_unavailable}
            </p>
          )}
        </div>

        {/* Verdicts */}
        <div className="min-w-0">
          <div className="typo-body font-medium text-foreground/85 mb-1.5">
            {t.director.recent_verdicts}
          </div>
          {verdicts.length === 0 ? (
            <p className="typo-caption text-foreground/55 italic px-1">
              {t.director.no_verdicts}
            </p>
          ) : (
            <ul className="space-y-1">
              {verdicts.map((v) => (
                <li
                  key={v.reviewId}
                  className="flex items-center gap-2 typo-caption px-2 py-1 rounded-card hover:bg-secondary/30 transition-colors"
                >
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${
                      v.severity === 'error'
                        ? 'bg-red-500/15 text-red-400'
                        : v.severity === 'warning'
                          ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-blue-500/15 text-blue-400'
                    }`}
                  >
                    {v.severity}
                  </span>
                  <span
                    className="text-foreground/85 truncate flex-1"
                    title={v.description ?? v.title}
                  >
                    {v.title}
                  </span>
                  <RelativeTime ts={v.createdAt} className="text-foreground/50 shrink-0" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
