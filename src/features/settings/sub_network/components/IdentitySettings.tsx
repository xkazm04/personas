import { useEffect, useState } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { Copy, Check, UserPlus, Trash2, Fingerprint } from 'lucide-react';
import { TrustVerifiedIcon, TrustUnknownIcon, TrustRevokedIcon } from './NetworkIcons';
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import { InlineConfirm } from './InlineConfirm';
import { useTranslation } from '@/i18n/useTranslation';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import Button from '@/features/shared/components/buttons/Button';

export { IdentitySettings };
export default function IdentitySettings() {
  const localIdentity = useSystemStore((s) => s.localIdentity);
  const trustedPeers = useSystemStore((s) => s.trustedPeers);
  const fetchLocalIdentity = useSystemStore((s) => s.fetchLocalIdentity);
  const fetchTrustedPeers = useSystemStore((s) => s.fetchTrustedPeers);
  const setDisplayName = useSystemStore((s) => s.setDisplayName);
  const exportIdentityCard = useSystemStore((s) => s.exportIdentityCard);
  const importTrustedPeer = useSystemStore((s) => s.importTrustedPeer);
  const revokePeerTrust = useSystemStore((s) => s.revokePeerTrust);
  const deleteTrustedPeer = useSystemStore((s) => s.deleteTrustedPeer);
  const addToast = useToastStore((s) => s.addToast);

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const { copied, copy } = useCopyToClipboard();
  const [importInput, setImportInput] = useState('');
  const [importNotes, setImportNotes] = useState('');
  const [showImportForm, setShowImportForm] = useState(false);
  const { t, tx } = useTranslation();
  const st = t.sharing;

  useEffect(() => {
    fetchLocalIdentity();
    fetchTrustedPeers();
  }, [fetchLocalIdentity, fetchTrustedPeers]);

  const handleSaveName = async () => {
    if (!nameInput.trim()) return;
    try {
      await setDisplayName(nameInput.trim());
      setEditingName(false);
      addToast(st.display_name_updated, 'success');
    } catch {
      addToast(st.display_name_update_failed, 'error');
    }
  };

  const handleCopyCard = async () => {
    try {
      const card = await exportIdentityCard();
      copy(card);
      addToast(st.identity_card_copied, 'success');
    } catch {
      addToast(st.identity_card_export_failed, 'error');
    }
  };

  const handleImportPeer = async () => {
    if (!importInput.trim()) return;
    try {
      const peer = await importTrustedPeer(importInput.trim(), importNotes || undefined);
      setImportInput('');
      setImportNotes('');
      setShowImportForm(false);
      addToast(tx(st.trusted_peer_added, { name: peer.display_name }), 'success');
    } catch {
      addToast(st.peer_import_failed, 'error');
    }
  };

  const handleRevoke = async (peerId: string, name: string) => {
    try {
      await revokePeerTrust(peerId);
      addToast(tx(st.trust_revoked_toast, { name }), 'success');
    } catch {
      addToast(st.revoke_trust_failed, 'error');
    }
  };

  const handleDelete = async (peerId: string, name: string) => {
    try {
      await deleteTrustedPeer(peerId);
      addToast(tx(st.peer_removed_toast, { name }), 'success');
    } catch {
      addToast(st.peer_delete_failed, 'error');
    }
  };

  const truncatePeerId = (id: string) =>
    id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id;

  return (
    <div className="space-y-6 p-4 max-w-2xl">
      {/* Local Identity */}
      <section>
        <h3 className="typo-heading text-foreground mb-3 flex items-center gap-2">
          <Fingerprint className="w-4 h-4" />
          {st.your_identity}
        </h3>
        <div className="rounded-modal border border-border bg-surface-1 p-4 space-y-3">
          {localIdentity ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="typo-caption text-foreground">{st.peer_id_label}</div>
                  <div className="typo-code text-foreground">
                    {truncatePeerId(localIdentity.peer_id)}
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={handleCopyCard}
                  variant="secondary"
                  size="sm"
                  icon={copied ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
                >
                  {copied ? t.common.copied : st.copy_identity_card}
                </Button>
              </div>

              <div>
                <div className="typo-caption text-foreground mb-1">{st.display_name_label}</div>
                {editingName ? (
                  <div className="flex gap-2">
                    <input
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSaveName(); }}
                      className="flex-1 px-2 py-1 typo-body rounded-card border border-border bg-background focus-ring"
                      maxLength={64}
                      autoFocus
                    />
                    <Button type="button" onClick={handleSaveName} variant="primary" size="xs">{st.save}</Button>
                    <Button type="button" onClick={() => setEditingName(false)} variant="secondary" size="xs">{st.cancel}</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="typo-body text-foreground">{localIdentity.display_name}</span>
                    <Button
                      type="button"
                      onClick={() => { setNameInput(localIdentity.display_name); setEditingName(true); }}
                      variant="ghost"
                      size="sm"
                    >
                      {st.edit}
                    </Button>
                  </div>
                )}
              </div>

              <div className="typo-caption text-foreground">
                {(() => {
                  const [before, after] = st.created_on.split('{date}');
                  return <>{before}<AbsoluteTime timestamp={localIdentity.created_at} variant="date" />{after}</>;
                })()}
              </div>
            </>
          ) : (
            /* Cold load: small delayed ghost bars, geometry-matched to the
               identity block above. Invisible for the first 120ms so a fast
               fetch never paints one. */
            <div className="space-y-3" aria-hidden="true">
              <div className="flex items-center justify-between animate-fade-in" style={{ animationDelay: '120ms' }}>
                <div className="space-y-1.5">
                  <span className="block h-2.5 w-20 rounded-interactive bg-primary/[0.06]" />
                  <span className="block h-3.5 w-32 rounded-interactive bg-primary/[0.06]" />
                </div>
                <span className="h-7 w-28 rounded-card bg-primary/[0.06]" />
              </div>
              <div className="space-y-1.5 animate-fade-in" style={{ animationDelay: '155ms' }}>
                <span className="block h-2.5 w-24 rounded-interactive bg-primary/[0.06]" />
                <span className="block h-3.5 w-28 rounded-interactive bg-primary/[0.06]" />
              </div>
              <span className="block h-2.5 w-32 rounded-interactive bg-primary/[0.06] animate-fade-in" style={{ animationDelay: '190ms' }} />
            </div>
          )}
        </div>
      </section>

      {/* Trusted Peers */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="typo-heading text-foreground">{st.trusted_peers}</h3>
          <Button
            type="button"
            onClick={() => setShowImportForm(!showImportForm)}
            variant="secondary"
            size="xs"
            icon={<UserPlus className="w-3.5 h-3.5" />}
          >
            {st.add_peer}
          </Button>
        </div>

        {showImportForm && (
          <div className="rounded-modal border border-border bg-surface-1 p-4 mb-3 space-y-2">
            <label className="typo-caption text-foreground">{st.paste_identity_card}</label>
            <textarea
              value={importInput}
              onChange={(e) => setImportInput(e.target.value)}
              placeholder={st.paste_card_placeholder}
              className="w-full px-3 py-2 typo-code rounded-card border border-border bg-background focus-ring resize-none"
              rows={3}
            />
            <input
              value={importNotes}
              onChange={(e) => setImportNotes(e.target.value)}
              placeholder={st.notes_placeholder}
              className="w-full px-3 py-1.5 typo-body rounded-card border border-border bg-background focus-ring"
            />
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                onClick={handleImportPeer}
                disabled={!importInput.trim()}
                variant="primary"
                size="sm"
              >
                {st.add_trusted_peer}
              </Button>
              <Button
                type="button"
                onClick={() => { setShowImportForm(false); setImportInput(''); setImportNotes(''); }}
                variant="secondary"
                size="sm"
              >
                {st.cancel}
              </Button>
            </div>
          </div>
        )}

        {trustedPeers.length === 0 ? (
          <div className="rounded-modal border border-dashed border-border p-6 text-center typo-body text-foreground">
            {st.no_trusted_peers}
          </div>
        ) : (
          <div className="space-y-2">
            {trustedPeers.map((peer) => (
              <div
                key={peer.peer_id}
                className="rounded-modal border border-border bg-surface-1 p-3 flex items-center justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 typo-body text-foreground truncate">
                    {peer.trust_level === 'verified' ? (
                      <TrustVerifiedIcon className="w-3.5 h-3.5 text-status-success flex-shrink-0" />
                    ) : peer.trust_level === 'revoked' ? (
                      <TrustRevokedIcon className="w-3.5 h-3.5 text-status-error flex-shrink-0" />
                    ) : (
                      <TrustUnknownIcon className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
                    )}
                    <span className="truncate">{peer.display_name}</span>
                  </div>
                  <div className="typo-code text-foreground">{truncatePeerId(peer.peer_id)}</div>
                  {peer.notes && (
                    <div className="typo-caption text-foreground mt-0.5">{peer.notes}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <span className={`typo-caption px-1.5 py-0.5 rounded-full ${
                    peer.trust_level === 'manual' ? 'bg-status-info/10 text-status-info' :
                    peer.trust_level === 'verified' ? 'bg-status-success/10 text-status-success' :
                    'bg-status-error/10 text-status-error'
                  }`}>
                    {peer.trust_level}
                  </span>
                  {peer.trust_level !== 'revoked' && (
                    <InlineConfirm
                      message={tx(st.revoke_trust_confirm, { name: peer.display_name })}
                      onConfirm={() => handleRevoke(peer.peer_id, peer.display_name)}
                    >
                      {({ requestConfirm }) => (
                        <Button
                          type="button"
                          onClick={requestConfirm}
                          tooltip={t.sharing.revoke_trust} aria-label={t.sharing.revoke_trust}
                          variant="ghost"
                          size="icon-sm"
                        >
                          <TrustRevokedIcon className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </InlineConfirm>
                  )}
                  <InlineConfirm
                    message={tx(st.remove_peer_confirm, { name: peer.display_name })}
                    onConfirm={() => handleDelete(peer.peer_id, peer.display_name)}
                  >
                    {({ requestConfirm }) => (
                      <Button
                        type="button"
                        onClick={requestConfirm}
                        tooltip={t.sharing.remove_peer} aria-label={t.sharing.remove_peer}
                        variant="ghost"
                        size="icon-sm"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </InlineConfirm>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
