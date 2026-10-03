import { Download, ExternalLink, RefreshCw } from 'lucide-react';

import { Dot, KitButton, Stack, UnitStrip } from '@/features/shared/components/kit';
import type { InstallState } from '@/hooks/utility/data/useAutoInstaller';
import { useTranslation } from '@/i18n/useTranslation';
import type { HealthCheckStatus } from '@/lib/bindings/HealthCheckStatus';

const CLAUDE_DOWNLOAD_URL = 'https://docs.anthropic.com/en/docs/claude-code/overview';

/** Ten units of ten percent each; the strip states its quantum through `legend` (grow-2). */
const PROGRESS_UNITS = 10;

/**
 * The install affordance for `node` and `claude_cli`, composed from the kit (kit batch home-3).
 *
 * It used to hand-roll everything it drew: a raw `violet-500` progress bar, `violet-300` ink, a
 * bare `<a>` styled as a button, `emerald-400` and `red-400` result lines. Progress is now the
 * kit's `UnitStrip` -- a quantity drawn as countable units of a stated quantum, in the theme's own
 * `primary` -- and every result line is a `Dot` in the tone of its meaning with the word beside it.
 *
 * `compact` is the form that sits in a row's Action cell: the one press and nothing taller. The
 * progress strip, the last line of installer output and the manual command are the detail layer's,
 * because a 56px row must never be decided by its content (Gate 2b).
 */
export function InstallButton({ checkId, status, installState, onInstall, compact }: {
  checkId: 'node' | 'claude_cli';
  status: HealthCheckStatus;
  installState: InstallState;
  onInstall: () => void;
  compact?: boolean;
}) {
  const { t, tx } = useTranslation();
  if (status === 'ok') return null;

  const label = checkId === 'node' ? t.overview.install_button.install_node : t.overview.install_button.install_cli;
  const phase = installState.phase;

  if (phase === 'downloading' || phase === 'installing') {
    const word = phase === 'downloading' ? t.overview.install_button.downloading : t.overview.install_button.installing;
    const done = Math.max(0, Math.min(PROGRESS_UNITS, Math.round((installState.progressPct / 100) * PROGRESS_UNITS)));
    const strip = (
      <UnitStrip
        size="s"
        label={tx(t.system_health.install_progress, { phase: word, pct: Math.round(installState.progressPct) })}
        legend={t.system_health.install_unit}
        segments={[
          { n: done, tone: 'primary', glyph: 'solid' },
          { n: PROGRESS_UNITS - done, tone: 'neutral', glyph: 'empty' },
        ]}
      />
    );
    if (compact) return strip;
    const tail = installState.outputLines[installState.outputLines.length - 1];
    return (
      <Stack gap="s">
        <span className="typo-label k-regular">{word}</span>
        {strip}
        {tail && <span className="typo-caption">{tail}</span>}
      </Stack>
    );
  }

  if (phase === 'completed') {
    return (
      <span className="flex items-center gap-2">
        <Dot tone="success" glyph="solid" />
        <span className="typo-caption">{t.overview.install_button.installed_success}</span>
      </span>
    );
  }

  if (phase === 'failed') {
    const retry = (
      <KitButton onClick={onInstall} icon={<RefreshCw />} stopPropagation>
        {t.overview.install_button.retry}
      </KitButton>
    );
    if (compact) return retry;
    return (
      <Stack gap="s">
        <span className="flex items-center gap-2">
          <Dot tone="error" glyph="solid" />
          <span className="typo-caption">{installState.error || t.overview.install_button.installation_failed}</span>
        </span>
        {installState.manualCommand && (
          <span className="flex flex-col gap-1">
            <span className="typo-caption">{t.overview.install_button.try_manually}</span>
            <code className="typo-code select-all">{installState.manualCommand}</code>
          </span>
        )}
        <span className="flex items-center gap-2 flex-wrap">
          {retry}
          {checkId === 'claude_cli' && <OfficialPageButton />}
        </span>
      </Stack>
    );
  }

  return (
    <span className="flex items-center gap-2 flex-wrap">
      <KitButton tone="primary" onClick={onInstall} icon={<Download />} stopPropagation>{label}</KitButton>
      {checkId === 'claude_cli' && !compact && <OfficialPageButton />}
    </span>
  );
}

function OfficialPageButton() {
  const { t } = useTranslation();
  return (
    <KitButton
      tone="quiet"
      icon={<ExternalLink />}
      stopPropagation
      onClick={() => window.open(CLAUDE_DOWNLOAD_URL, '_blank', 'noopener,noreferrer')}
    >
      {t.overview.install_button.official_page}
    </KitButton>
  );
}
