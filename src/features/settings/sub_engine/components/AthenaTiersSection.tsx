import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AsyncButton } from '@/features/shared/components/buttons';
import type { AthenaEngine } from '@/lib/bindings/AthenaEngine';
import type { EngineAvailability } from '@/lib/bindings/EngineAvailability';
import { AthenaTierRow, ENGINE_LABELS } from './AthenaTierRow';
import { TIER_CLASSES, useAthenaTiers } from './useAthenaTiers';

const ENGINES: AthenaEngine[] = ['claude', 'grok'];
/** A probe that answers faster than this never shows a ghost at all. */
const GHOST_DELAY_MS = 300;

/**
 * Per-engine availability pill. While the probe runs it is a calm delayed
 * ghost under the engine name (loading pattern v2: chrome first, never a
 * spinner); then the version when installed, or the probe's reason when not.
 */
function EngineBadge({ engine, probe }: { engine: AthenaEngine; probe: EngineAvailability | null | undefined }) {
  const { t } = useTranslation();
  const s = t.settings.athenaTiers;
  const probing = probe === undefined;
  const [showGhost, setShowGhost] = useState(false);
  useEffect(() => {
    if (!probing) {
      setShowGhost(false);
      return;
    }
    const id = window.setTimeout(() => setShowGhost(true), GHOST_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [probing]);

  const pill = probe?.installed
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
    : 'bg-rose-500/10 text-rose-400 border-rose-500/20';

  return (
    <div
      data-testid={`athena-engine-badge-${engine}`}
      data-state={probing ? 'probing' : probe?.installed ? 'installed' : 'missing'}
      className="flex items-center gap-2 typo-caption text-foreground"
    >
      <span className="font-medium">{ENGINE_LABELS[engine]}</span>
      {probing ? (
        <span
          aria-label={s.probing}
          className={`inline-block h-4 w-20 rounded-full bg-primary/[0.06] transition-opacity ${showGhost ? 'opacity-100' : 'opacity-0'}`}
        />
      ) : (
        <span className={`px-1.5 py-0.5 rounded-full border ${pill}`}>
          {probe?.installed ? (probe.version ?? s.installed) : (probe?.detail ?? s.not_installed)}
        </span>
      )}
    </div>
  );
}

/**
 * Settings > Engine > Athena tiers: which CLI, model and effort serve each
 * class of Athena turn (Main / Aside / Micro). Persisted through
 * `companion_set_engine_settings`; availability from `companion_probe_engines`.
 */
export function AthenaTiersSection() {
  const { t } = useTranslation();
  const s = t.settings.athenaTiers;
  const { settings, availability, loadError, probeFailed, patchTier, save } = useAthenaTiers();

  const installed =
    availability === null
      ? null
      : new Set(availability.filter((a) => a.installed).map((a) => a.engine));
  // Grok's model list comes from the probe (`grok models` on this machine),
  // never from a client-side copy of the Rust catalog.
  const grokModels = availability?.find((a) => a.engine === 'grok')?.models ?? [];

  return (
    <div data-testid="athena-tiers-section" className="space-y-4">
      <p className="typo-caption text-foreground">{s.description}</p>

      <div className="flex flex-wrap gap-4">
        {ENGINES.map((engine) => (
          <EngineBadge
            key={engine}
            engine={engine}
            // `undefined` = still probing; `null` = probe answered without this engine.
            probe={availability === null ? undefined : (availability.find((a) => a.engine === engine) ?? null)}
          />
        ))}
      </div>

      {probeFailed && (
        <p className="typo-caption text-foreground" data-testid="athena-tiers-probe-error">
          {s.probe_failed}
        </p>
      )}

      {loadError && (
        <p className="typo-caption text-foreground" data-testid="athena-tiers-load-error">
          {s.load_failed}
        </p>
      )}

      {settings && (
        <div className="space-y-2">
          {TIER_CLASSES.map((cls) => (
            <AthenaTierRow
              key={cls}
              cls={cls}
              tier={settings[cls]}
              installed={installed}
              grokModels={grokModels}
              onChange={(patch) => patchTier(cls, patch)}
            />
          ))}
        </div>
      )}

      <p className="typo-caption text-foreground">{s.fallback_note}</p>

      <div className="flex gap-2">
        <AsyncButton variant="primary" onClick={save} data-testid="athena-tiers-save">
          <Save className="w-4 h-4" />
          {s.save}
        </AsyncButton>
      </div>
    </div>
  );
}
