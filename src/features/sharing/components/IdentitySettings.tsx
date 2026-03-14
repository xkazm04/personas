import { useEffect, useState } from 'react';
import { Copy, Check, UserPlus, Trash2, Fingerprint } from 'lucide-react';
import { TrustVerifiedIcon, TrustUnknownIcon, TrustRevokedIcon } from './NetworkIcons';
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import { InlineConfirm } from './InlineConfirm';

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
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Fingerprint className="w-4 h-4" />
          Your Identity
        </h3>
        <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
          {localIdentity ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Peer ID</div>
                  <div className="text-sm font-mono text-foreground/80">
                    {truncatePeerId(localIdentity.peer_id)}
                  </div>
                </div>
                <button
                  onClick={handleCopyCard}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy Identity Card'}
                </button>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Display Name</div>
                {editingName ? (
                  <div className="flex gap-2">
                    <input
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                      className="flex-1 px-2 py-1 text-sm rounded-lg border border-border bg-background focus-ring"
                      maxLength={64}
                      autoFocus
                    />
                    <button onClick={handleSaveName} className="px-2 py-1 text-xs rounded-lg bg-primary text-white hover:bg-primary/90">Save</button>
                    <button onClick={() => setEditingName(false)} className="px-2 py-1 text-xs rounded-lg border border-border hover:bg-secondary/50">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground">{localIdentity.display_name}</span>
                    <button
                      onClick={() => { setNameInput(localIdentity.display_name); setEditingName(true); }}
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                Created {new Date(localIdentity.created_at).toLocaleDateString()}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Loading identity...</div>
          )}
        </div>
      </section>

      {/* Trusted Peers */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Trusted Peers</h3>
          <button
            onClick={() => setShowImportForm(!showImportForm)}
            className="px-2.5 py-1 text-xs rounded-lg border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add Peer
          </button>
        </div>

        {showImportForm && (
          <div className="rounded-xl border border-border bg-secondary/20 p-4 mb-3 space-y-2">
            <label className="text-xs text-muted-foreground">Paste identity card</label>
            <textarea
              value={importInput}
              onChange={(e) => setImportInput(e.target.value)}
              placeholder="Paste the base64 identity card here..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus-ring font-mono resize-none"
              rows={3}
            />
            <input
              value={importNotes}
              onChange={(e) => setImportNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-border bg-background focus-ring"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleImportPeer}
                disabled={!importInput.trim()}
                className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Trusted Peer
              </button>
              <button
                onClick={() => { setShowImportForm(false); setImportInput(''); setImportNotes(''); }}
                className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary/50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {trustedPeers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No trusted peers yet. Share your identity card with others to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {trustedPeers.map((peer) => (
              <div
                key={peer.peer_id}
                className="rounded-xl border border-border bg-secondary/20 p-3 flex items-center justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground truncate">
                    {peer.trust_level === 'verified' ? (
                      <TrustVerifiedIcon className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    ) : peer.trust_level === 'revoked' ? (
                      <TrustRevokedIcon className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    ) : (
                      <TrustUnknownIcon className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    )}
                    <span className="truncate">{peer.display_name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{truncatePeerId(peer.peer_id)}</div>
                  {peer.notes && (
                    <div className="text-xs text-muted-foreground/70 mt-0.5">{peer.notes}</div>
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
                          className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-amber-500 transition-colors"
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
                        className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-red-500 transition-colors"
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
