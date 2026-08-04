import { useCallback, useState } from 'react';
import { Hash, Link2, Link2Off, AlertTriangle } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useTeamSlackBridge, type BridgeForm } from './useTeamSlackBridge';
import { SlackBridgePickers } from './SlackBridgePickers';
import { SlackBridgeDirections } from './SlackBridgeDirections';

/**
 * Team ↔ Slack bridge setup, rendered as a section of the team workspace pane.
 *
 * The bridge is not its own entity: it is a shape-v2 notification channel on
 * ONE member persona, flagged `config.teamBridge`. That is why this panel asks
 * which persona carries it, and why a disabled persona is called out inline —
 * the poller and the outbound relay both scan `personas::get_enabled`, so a
 * disabled carrier silently stops the wire.
 */
export function TeamSlackBridgePanel({ teamId }: { teamId: string }) {
  const { t, tx } = useTranslation();
  const ts = t.pipeline.team_studio;
  const addToast = useToastStore((s) => s.addToast);
  const bridge = useTeamSlackBridge(teamId);
  const [saving, setSaving] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const patch = useCallback(
    (p: Partial<BridgeForm>) => bridge.setForm((prev) => ({ ...prev, ...p })),
    [bridge],
  );

  const canSave = !!bridge.form.personaId && !!bridge.form.credentialId && !!bridge.form.channel.trim();

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const ok = await bridge.save();
      addToast(ok ? ts.slack_bridge_saved : ts.slack_bridge_save_failed, ok ? 'success' : 'error');
    } catch (err) {
      toastCatch('teamStudio/TeamSlackBridgePanel:save', ts.slack_bridge_save_failed)(err);
    } finally {
      setSaving(false);
    }
  }, [bridge, addToast, ts]);

  const handleUnlink = useCallback(async () => {
    setConfirmUnlink(false);
    try {
      const ok = await bridge.unlink();
      addToast(ok ? ts.slack_bridge_unlinked : ts.slack_bridge_save_failed, ok ? 'success' : 'error');
    } catch (err) {
      toastCatch('teamStudio/TeamSlackBridgePanel:unlink', ts.slack_bridge_save_failed)(err);
    }
  }, [bridge, addToast, ts]);

  const linked = !!bridge.linkedPersonaId;
  const noCredential = bridge.slackCredentials.length === 0;
  const noMembers = bridge.members.length === 0;

  return (
    <div
      className="rounded-card border border-primary/10 bg-secondary/10 p-3 space-y-3"
      data-testid="team-slack-bridge-panel"
    >
      {/* Static chrome always renders — a fetch never hides it (loading v2). */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Hash className="w-3.5 h-3.5 text-teal-300/80" />
          <span className="typo-label uppercase tracking-wider text-foreground">{ts.slack_bridge_heading}</span>
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full typo-caption ${
            linked ? 'border border-teal-500/25 bg-teal-500/10 text-teal-300' : 'text-foreground/60'
          }`}
          data-testid="team-slack-bridge-status"
        >
          {linked ? <Link2 className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
          {linked
            ? tx(ts.slack_bridge_connected, { channel: bridge.form.channelName || bridge.form.channel })
            : ts.slack_bridge_not_connected}
        </span>
      </div>
      <p className="typo-caption font-normal text-foreground">{ts.slack_bridge_hint}</p>

      {/* Ghost only while loading AND nothing to show yet. */}
      {bridge.loading && !linked && !bridge.form.credentialId ? (
        <div className="h-24 rounded-input bg-secondary/20 animate-pulse" aria-hidden />
      ) : noCredential ? (
        <div className="rounded-input border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
          <div className="flex items-center gap-1.5 typo-body text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {ts.slack_bridge_no_credential_title}
          </div>
          <p className="typo-caption font-normal text-foreground">{ts.slack_bridge_no_credential_body}</p>
        </div>
      ) : noMembers ? (
        <p className="typo-caption font-normal text-foreground">{ts.slack_bridge_no_members}</p>
      ) : (
        <>
          <SlackBridgePickers
            form={bridge.form}
            onChange={patch}
            members={bridge.members}
            slackCredentials={bridge.slackCredentials}
            selectedPersona={bridge.selectedPersona}
            channelItems={bridge.channelItems}
            channelsLoading={bridge.channelsLoading}
            channelsFailed={bridge.channelsFailed}
          />
          <SlackBridgeDirections form={bridge.form} onChange={patch} />
          {bridge.legacyBlob && (
            <p className="flex items-start gap-1.5 typo-caption font-normal text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {ts.slack_bridge_legacy_warning}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              disabled={!canSave}
              disabledReason={ts.slack_bridge_save_disabled_reason}
              onClick={() => void handleSave()}
              data-testid="team-slack-bridge-save"
            >
              {linked ? ts.slack_bridge_update : ts.slack_bridge_save}
            </Button>
            {linked && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirmUnlink(true)}
                data-testid="team-slack-bridge-unlink"
              >
                {ts.slack_bridge_unlink}
              </Button>
            )}
          </div>
        </>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          danger
          title={ts.slack_bridge_unlink_title}
          body={ts.slack_bridge_unlink_body}
          confirmLabel={ts.slack_bridge_unlink_confirm}
          onConfirm={() => void handleUnlink()}
          onCancel={() => setConfirmUnlink(false)}
        />
      )}
    </div>
  );
}

export default TeamSlackBridgePanel;
