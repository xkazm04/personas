import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain,
  HelpCircle,
  Plus,
  Wrench,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import {
  companionListActiveConnectors,
  companionListPluginToggles,
  companionRemoveConnector,
  companionSetActiveConnectors,
  companionSetConnectorEnabled,
  companionSetPluginEnabled,
} from '@/api/companion';
import { ComposerConnectorsPickerModal } from '@/features/agents/sub_glyph/commandPanel/composer/ComposerConnectorsPickerModal';
import { ComposerBrandIcon } from '@/features/agents/sub_glyph/commandPanel/composer/ComposerBrandIcon';
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useCompanionStore } from './companionStore';
import { VoiceControlPopover } from './VoiceControlPopover';

/**
 * Right-edge sidebar with three groups:
 *
 *   1. **Plugins** (top) — togglable plugin awareness. v1 ships
 *      `dev_tools`. When enabled, the prompt builder appends a
 *      capability block teaching Athena what the plugin offers
 *      (codebase scan / idea gen / task batching / projects state)
 *      and when to lean on it. The user no longer triggers individual
 *      seed prompts; Athena leads the flow once she's aware.
 *   2. **Assist** (middle) — existing help / brain / voice trio.
 *   3. **Connectors** (bottom) — pinned vault credentials. Click
 *      toggles enabled (visual: brighter ring + glow when on); right-
 *      click → "Remove from sidebar". Plus button opens the standard
 *      `ComposerConnectorsPickerModal` (passed `solid` so it doesn't
 *      blend through the chat panel's translucent backdrop).
 *
 * Layout: 44px wide, three groups separated by thin dividers, with
 * a flex spacer pushing connectors to the bottom edge.
 */
export function CompanionToolbar({
  onAskCapabilities,
  onOpenBrain,
  brainOpen,
  disabled,
}: {
  onAskCapabilities: () => void;
  onOpenBrain: () => void;
  brainOpen: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const voiceEngine = useSystemStore((s) => s.companionVoiceEngine);
  const voiceCredentialId = useSystemStore((s) => s.companionVoiceCredentialId);
  const voiceId = useSystemStore((s) => s.companionVoiceId);
  const piperVoiceId = useSystemStore((s) => s.companionPiperVoiceId);
  const voiceConfigured =
    voiceEngine === 'piper' ? Boolean(piperVoiceId) : Boolean(voiceCredentialId && voiceId);

  const connectors = useCompanionStore((s) => s.connectors);
  const setConnectors = useCompanionStore((s) => s.setConnectors);
  const pluginToggles = useCompanionStore((s) => s.pluginToggles);
  const setPluginToggles = useCompanionStore((s) => s.setPluginToggles);
  const addToast = useToastStore((s) => s.addToast);

  const [pickerOpen, setPickerOpen] = useState(false);

  // Hydrate connectors + plugin toggles once on mount.
  useEffect(() => {
    companionListActiveConnectors()
      .then(setConnectors)
      .catch(silentCatch('companion_list_active_connectors'));
    companionListPluginToggles()
      .then(setPluginToggles)
      .catch(silentCatch('companion_list_plugin_toggles'));
  }, [setConnectors, setPluginToggles]);

  const pickerSelectedNames = useMemo(
    () => connectors.map((c) => c.connectorName),
    [connectors],
  );

  const devToolsEnabled = useMemo(
    () => pluginToggles.some((p) => p.pluginName === 'dev_tools' && p.enabled),
    [pluginToggles],
  );

  const toggleDevTools = async () => {
    const next = !devToolsEnabled;
    try {
      await companionSetPluginEnabled('dev_tools', next);
      // Optimistic local update — if the toggle row didn't exist yet,
      // synthesize it. Backend list always returns the canonical set.
      const updated = pluginToggles.some((p) => p.pluginName === 'dev_tools')
        ? pluginToggles.map((p) =>
            p.pluginName === 'dev_tools'
              ? { ...p, enabled: next, updatedAt: new Date().toISOString() }
              : p,
          )
        : [
            ...pluginToggles,
            {
              pluginName: 'dev_tools',
              enabled: next,
              updatedAt: new Date().toISOString(),
            },
          ];
      setPluginToggles(updated);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
      silentCatch('companion_set_plugin_enabled')(err);
    }
  };

  return (
    <aside
      className="shrink-0 w-11 border-l border-foreground/10 flex flex-col items-center py-3 gap-1.5 bg-foreground/[0.02]"
      aria-label={t.plugins.companion.toolbar_label}
      data-testid="companion-toolbar"
    >
      {/* Plugins group — single Dev Tools toggle */}
      <PluginToggleButton
        icon={<Wrench className="w-4 h-4" />}
        label={
          devToolsEnabled
            ? t.plugins.companion.dev_tools_disable
            : t.plugins.companion.dev_tools_enable
        }
        enabled={devToolsEnabled}
        onClick={toggleDevTools}
        testId="companion-plugin-dev-tools"
      />

      <Divider />

      {/* Assist group (existing) */}
      <ToolbarButton
        icon={<HelpCircle className="w-4 h-4" />}
        label={t.plugins.companion.help_capabilities}
        onClick={onAskCapabilities}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<Brain className="w-4 h-4" />}
        label={t.plugins.companion.brain_open}
        onClick={onOpenBrain}
        active={brainOpen}
      />
      {voiceConfigured && <VoiceControlPopover />}

      {/* Spacer pushes the connectors group to the bottom. */}
      <div className="flex-1" />

      <Divider />

      {/* Connectors group */}
      {connectors.map((c) => (
        <ConnectorIconButton
          key={c.connectorName}
          name={c.connectorName}
          enabled={c.enabled}
          onToggle={async () => {
            const next = !c.enabled;
            try {
              await companionSetConnectorEnabled(c.connectorName, next);
              setConnectors(
                connectors.map((row) =>
                  row.connectorName === c.connectorName
                    ? { ...row, enabled: next }
                    : row,
                ),
              );
            } catch (err: unknown) {
              addToast(
                err instanceof Error ? err.message : String(err),
                'error',
              );
              silentCatch('companion_set_connector_enabled')(err);
            }
          }}
          onRemove={async () => {
            try {
              await companionRemoveConnector(c.connectorName);
              setConnectors(
                connectors.filter(
                  (row) => row.connectorName !== c.connectorName,
                ),
              );
            } catch (err: unknown) {
              addToast(
                err instanceof Error ? err.message : String(err),
                'error',
              );
              silentCatch('companion_remove_connector')(err);
            }
          }}
        />
      ))}
      <ToolbarButton
        icon={<Plus className="w-4 h-4" />}
        label={t.plugins.companion.connectors_add}
        onClick={() => setPickerOpen(true)}
        testId="companion-connectors-add"
      />

      <ComposerConnectorsPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selected={pickerSelectedNames}
        solid
        onApply={async (next) => {
          try {
            const updated = await companionSetActiveConnectors(next);
            setConnectors(updated);
            setPickerOpen(false);
          } catch (err: unknown) {
            addToast(
              err instanceof Error ? err.message : String(err),
              'error',
            );
            silentCatch('companion_set_active_connectors')(err);
          }
        }}
      />
    </aside>
  );
}

function Divider() {
  return <div className="my-1 w-6 border-t border-foreground/10" aria-hidden />;
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`w-8 h-8 rounded-interactive inline-flex items-center justify-center transition-colors focus-ring disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? 'bg-primary/15 text-primary'
          : 'text-foreground hover:text-foreground hover:bg-foreground/5'
      }`}
      aria-label={label}
      title={label}
      aria-pressed={active}
    >
      {icon}
    </button>
  );
}

/**
 * Plugin-style toggle: visually distinct from a regular ToolbarButton
 * so the user can tell at a glance "this is a *capability mode*, not
 * a one-shot action." Enabled = primary-colored ring + glow + filled
 * bg; disabled = muted neutral. Mirrors the connector icon's "ring
 * highlight when active" pattern below.
 */
function PluginToggleButton({
  icon,
  label,
  enabled,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  enabled: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      data-companion-plugin-enabled={enabled ? 'true' : 'false'}
      className={`w-8 h-8 rounded-interactive inline-flex items-center justify-center transition-all focus-ring ${
        enabled
          ? 'bg-primary/25 text-primary ring-1 ring-primary/60'
          : 'text-foreground hover:text-foreground hover:bg-foreground/5'
      }`}
      // Themed glow that tracks the active theme's primary, instead of the
      // old hardcoded blue rgba that was off-brand on every non-blue theme.
      style={
        enabled
          ? { boxShadow: '0 0 10px color-mix(in srgb, var(--primary) 40%, transparent)' }
          : undefined
      }
      aria-label={label}
      title={label}
      aria-pressed={enabled}
    >
      {icon}
    </button>
  );
}

/**
 * One pinned connector. Single click toggles enabled (visual: brighter
 * ring + glow when on, dimmed when off). Right-click opens a tiny
 * context menu with "Remove from sidebar".
 *
 * Earlier iteration used a 32×32 button with an 18px brand mask + only
 * an opacity diff between states — barely legible. This version is
 * still 32×32 (matches the rest of the toolbar visually) but the icon
 * is bigger (22px), the *enabled* state gets a ring + soft glow + a
 * tinted bg, and the *disabled* state drops opacity AND removes the
 * ring. The contrast makes "is this thing on?" glanceable.
 */
function ConnectorIconButton({
  name,
  enabled,
  onToggle,
  onRemove,
}: {
  name: string;
  enabled: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const meta = useMemo(() => getConnectorMeta(name), [name]);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Contrast strategy: every connector renders on top of an *always-
  // visible* light disc (`bg-foreground/10` baseline, brighter when
  // enabled). This is critical for dark-brand connectors — Sentry's
  // ~#362D59 purple was nearly invisible against the dark sidebar bg
  // before. The disc is the contrast surface; the brand color provides
  // identity on top. Enabled state adds a brand-tinted ring + soft
  // glow so the user can tell at a glance which tools are live.
  //
  // Using inline `boxShadow`/`borderColor` with the brand color keeps
  // each connector's accent visually identifiable even when several
  // are pinned side by side.
  const enabledStyle = enabled
    ? {
        boxShadow: `0 0 10px ${meta.color}66`,
      }
    : undefined;
  const ringStyle = enabled
    ? { borderColor: `${meta.color}cc` }
    : { borderColor: 'transparent' };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={onToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        data-testid={`companion-connector-${name}`}
        data-companion-connector-enabled={enabled ? 'true' : 'false'}
        className={`w-9 h-9 rounded-full inline-flex items-center justify-center border-2 transition-all focus-ring overflow-hidden ${
          enabled
            ? 'bg-foreground text-background'
            : 'bg-foreground/20 hover:bg-foreground/35'
        }`}
        style={{ ...enabledStyle, ...ringStyle }}
        aria-label={`${meta.label} (${
          enabled
            ? t.plugins.companion.connector_state_enabled
            : t.plugins.companion.connector_state_disabled
        })`}
        title={`${meta.label} — ${
          enabled
            ? t.plugins.companion.connector_action_disable
            : t.plugins.companion.connector_action_enable
        } · ${t.plugins.companion.connector_right_click_menu_hint}`}
        aria-pressed={enabled}
      >
        {meta.iconUrl ? (
          <ComposerBrandIcon iconUrl={meta.iconUrl} color={meta.color} size={20} />
        ) : (
          <meta.Icon className="w-5 h-5" style={{ color: meta.color }} />
        )}
      </button>
      {menuOpen && (
        <div
          className="absolute right-9 top-0 z-50 min-w-[160px] rounded-card border border-foreground/15 bg-secondary/95 backdrop-blur-md shadow-elevation-3 py-1"
          role="menu"
        >
          <button
            onClick={() => {
              setMenuOpen(false);
              onRemove();
            }}
            className="w-full text-left px-3 py-1.5 typo-caption text-foreground/85 hover:bg-foreground/5 focus-ring"
            role="menuitem"
          >
            {t.plugins.companion.connectors_remove_from_sidebar}
          </button>
        </div>
      )}
    </div>
  );
}
