import { useEffect, useState } from 'react';
import { Copy, Check, UserPlus, Trash2, Fingerprint } from 'lucide-react';
import { TrustVerifiedIcon, TrustUnknownIcon, TrustRevokedIcon } from './NetworkIcons';
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import { InlineConfirm } from './InlineConfirm';
import { useTranslation } from '@/i18n/useTranslation';

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
  const [copied, setCopied] = useState(false);
  const [importInput, setImportInput] = useState('');
  const [importNotes, setImportNotes] = useState('');
  const [showImportForm, setShowImportForm] = useState(false);
  const { t } = useTranslation();
  const st = t.sharing;

  useEffect(() => {
    fetchLocalIdentity();
    fetchTrustedPeers();
  }, []);

  const handleSaveName = async () => {
    if (!nameInput.trim()) return;
    try {
      await setDisplayName(nameInput.trim());
      setEditingName(false);
      addToast('Display name updated', 'success');
    } catch {
      addToast('Failed to update display name', 'error');
    }
  };

  const handleCopyCard = async () => {
    try {
      const card = await exportIdentityCard();
      await navigator.clipboard.writeText(card);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addToast('Identity card copied to clipboard', 'success');
    } catch {
      addToast('Failed to export identity card', 'error');
    }
  };

  const handleImportPeer = async () => {
    if (!importInput.trim()) return;
    try {
      const peer = await importTrustedPeer(importInput.trim(), importNotes || undefined);
      setImportInput('');
      setImportNotes('');
      setShowImportForm(false);
      addToast(`Trusted peer "${peer.display_name}" added`, 'success');
    } catch {
      addToast('Failed to import peer -- check the identity card', 'error');
    }
  };

  const handleRevoke = async (peerId: string, name: string) => {
    try {
      await revokePeerTrust(peerId);
      addToast(`Trust revoked for "${name}"`, 'success');
    } catch {
      addToast('Failed to revoke trust', 'error');
    }
  };

  const handleDelete = async (peerId: string, name: string) => {
    try {
      await deleteTrustedPeer(peerId);
      addToast(`Peer "${name}" removed`, 'success');
    } catch {
      addToast('Failed to delete peer', 'error');
    }
  };

  const truncatePeerId = (id: string) =>
    id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id;

  return (
    <div className="space-y-6 p-4 max-w-2xl">
      {/* Local Identity */}
      <section>
        <h3 className="typo-heading font-semibold text-foreground mb-3 flex items-center gap-2">
          <Fingerprint className="w-4 h-4" />
          {st.your_identity}
        </h3>
        <div className="rounded-modal border border-border bg-secondary/20 p-4 space-y-3">
          {localIdentity ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="typo-caption text-foreground">{st.peer_id_label}</div>
                  <div className="typo-code font-mono text-foreground">
                    {truncatePeerId(localIdentity.peer_id)}
                  </div>
                </div>
                <button
                  onClick={handleCopyCard}
                  className="px-3 py-1.5 typo-caption rounded-card border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? t.common.copied : st.copy_identity_card}
                </button>
              </div>

              <div>
                <div className="typo-caption text-foreground mb-1">{st.display_name_label}</div>
                {editingName ? (
                  <div className="flex gap-2">
                    <input
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                      className="flex-1 px-2 py-1 typo-body rounded-card border border-border bg-background focus-ring"
                      maxLength={64}
                      autoFocus
                    />
                    <button onClick={handleSaveName} className="px-2 py-1 typo-caption rounded-card bg-primary text-white hover:bg-primary/90">{st.save}</button>
                    <button onClick={() => setEditingName(false)} className="px-2 py-1 typo-caption rounded-card border border-border hover:bg-secondary/50">{st.cancel}</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="typo-body text-foreground">{localIdentity.display_name}</span>
                    <button
                      onClick={() => { setNameInput(localIdentity.display_name); setEditingName(true); }}
                      className="typo-caption text-foreground hover:text-foreground underline"
                    >
                      {st.edit}
                    </button>
                  </div>
                )}
              </div>

              <div className="typo-caption text-foreground">
                Created {new Date(localIdentity.created_at).toLocaleDateString()}
              </div>
            </>
          ) : (
            <div className="typo-body text-foreground">{st.loading_identity}</div>
          )}
        </div>
      </section>

      {/* Trusted Peers */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="typo-heading font-semibold text-foreground">{st.trusted_peers}</h3>
          <button
            onClick={() => setShowImportForm(!showImportForm)}
            className="px-2.5 py-1 typo-caption rounded-card border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {st.add_peer}
          </button>
        </div>

        {showImportForm && (
          <div className="rounded-modal border border-border bg-secondary/20 p-4 mb-3 space-y-2">
            <label className="typo-caption text-foreground">{st.paste_identity_card}</label>
            <textarea
              value={importInput}
              onChange={(e) => setImportInput(e.target.value)}
              placeholder={st.paste_card_placeholder}
              className="w-full px-3 py-2 typo-code rounded-card border border-border bg-background focus-ring font-mono resize-none"
              rows={3}
            />
            <input
              value={importNotes}
              onChange={(e) => setImportNotes(e.target.value)}
              placeholder={st.notes_placeholder}
              className="w-full px-3 py-1.5 typo-body rounded-card border border-border bg-background focus-ring"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleImportPeer}
                disabled={!importInput.trim()}
                className="px-3 py-1.5 typo-caption rounded-card bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {st.add_trusted_peer}
              </button>
              <button
                onClick={() => { setShowImportForm(false); setImportInput(''); setImportNotes(''); }}
                className="px-3 py-1.5 typo-caption rounded-card border border-border hover:bg-secondary/50"
              >
                {st.cancel}
              </button>
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
                className="rounded-modal border border-border bg-secondary/20 p-3 flex items-center justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 typo-body font-medium text-foreground truncate">
                    {peer.trust_level === 'verified' ? (
                      <TrustVerifiedIcon className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    ) : peer.trust_level === 'revoked' ? (
                      <TrustRevokedIcon className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    ) : (
                      <TrustUnknownIcon className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    )}
                    <span className="truncate">{peer.display_name}</span>
                  </div>
                  <div className="typo-code text-foreground font-mono">{truncatePeerId(peer.peer_id)}</div>
                  {peer.notes && (
                    <div className="typo-caption text-foreground mt-0.5">{peer.notes}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    peer.trust_level === 'manual' ? 'bg-blue-500/10 text-blue-400' :
                    peer.trust_level === 'verified' ? 'bg-green-500/10 text-green-400' :
                    'bg-red-500/10 text-red-400'
                  }`}>
                    {peer.trust_level}
                  </span>
                  {peer.trust_level !== 'revoked' && (
                    <InlineConfirm
                      message={`Revoke trust for "${peer.display_name}"?`}
                      onConfirm={() => handleRevoke(peer.peer_id, peer.display_name)}
                    >
                      {({ requestConfirm }) => (
                        <button
                          onClick={requestConfirm}
                          title="Revoke trust"
                          className="p-1.5 rounded-card hover:bg-secondary/50 text-foreground hover:text-amber-500 transition-colors"
                        >
                          <TrustRevokedIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </InlineConfirm>
                  )}
                  <InlineConfirm
                    message={`Remove peer "${peer.display_name}"?`}
                    onConfirm={() => handleDelete(peer.peer_id, peer.display_name)}
                  >
                    {({ requestConfirm }) => (
                      <button
                        onClick={requestConfirm}
                        title="Remove peer"
                        className="p-1.5 rounded-card hover:bg-secondary/50 text-foreground hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
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
