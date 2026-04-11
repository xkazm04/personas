import { useState, useEffect, useCallback } from 'react';
import {
  FileSignature, ShieldCheck, Upload, CheckCircle2,
  XCircle, Trash2, Download, Copy, FileText, Clock
} from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useToastStore } from '@/stores/toastStore';
import {
  generateSigningKey,
  signDocument,
  verifyDocument,
  listDocumentSignatures,
  deleteDocumentSignature,
  exportSignatureSidecar,
  writeSidecarFile,
  readSidecarFile,
  type DocumentSignature,
  type VerifyDocumentResult,
} from '@/api/signing';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { PanelTabBar } from '@/features/shared/components/layout/PanelTabBar';

type Tab = 'sign' | 'verify' | 'history';

const DOC_TABS: { id: Tab; label: string }[] = [
  { id: 'sign', label: 'Sign' },
  { id: 'verify', label: 'Verify' },
  { id: 'history', label: 'History' },
];

export default function DocSigningPage() {
  const [tab, setTab] = useState<Tab>('sign');

  return (
    <ContentBox>
      <ContentHeader
        icon={<FileSignature className="w-5 h-5 text-rose-400" />}
        iconColor="red"
        title="Document Signing"
        subtitle="Ed25519 digital signatures with portable sidecar verification"
      >
        <PanelTabBar
          tabs={DOC_TABS}
          activeTab={tab}
          onTabChange={setTab}
          underlineClass="bg-rose-400"
          layoutIdPrefix="doc-signing"
        />
      </ContentHeader>

      <ContentBody centered>
        <div key={tab} className="animate-fade-slide-in">
          {tab === 'sign' && <SignPanel />}
          {tab === 'verify' && <VerifyPanel />}
          {tab === 'history' && <HistoryPanel />}
        </div>
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// Sign Panel
// ---------------------------------------------------------------------------

function SignPanel() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [metadata, setMetadata] = useState('');
  const [signing, setSigning] = useState(false);
  const [result, setResult] = useState<{ sidecarJson: string; fileName: string } | null>(null);
  const [keyStatus, setKeyStatus] = useState<{ peer_id: string; display_name: string } | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  // Auto-generate key on mount if needed
  useEffect(() => {
    generateSigningKey()
      .then((res) => setKeyStatus({ peer_id: res.peer_id, display_name: res.display_name }))
      .catch(() => { /* will generate on first sign */ });
  }, []);

  const pickFile = useCallback(async () => {
    const selected = await open({ multiple: false, directory: false });
    if (selected) {
      setFilePath(selected as string);
      setResult(null);
    }
  }, []);

  const handleSign = useCallback(async () => {
    if (!filePath) return;
    setSigning(true);
    try {
      const res = await signDocument(filePath, metadata || undefined);
      setResult({ sidecarJson: res.sidecar_json, fileName: res.signature.file_name });
      addToast(`Signed: ${res.signature.file_name}`, 'success');
    } catch (e: unknown) {
      addToast(`Signing failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setSigning(false);
    }
  }, [filePath, metadata, addToast]);

  const handleSaveSidecar = useCallback(async () => {
    if (!result) return;
    const path = await save({
      defaultPath: `${result.fileName}.sig.json`,
      filters: [{ name: 'Signature', extensions: ['sig.json', 'json'] }],
    });
    if (path) {
      await writeSidecarFile(path, result.sidecarJson);
      addToast('Sidecar saved', 'success');
    }
  }, [result, addToast]);

  const handleCopySidecar = useCallback(() => {
    if (!result) return;
    navigator.clipboard.writeText(result.sidecarJson);
    addToast('Sidecar copied to clipboard', 'success');
  }, [result, addToast]);

  return (
    <div className="max-w-2xl mx-auto space-y-6 pt-4">
      <div className="space-y-2">
        <h2 className="typo-heading text-lg text-foreground/90">Sign a Document</h2>
        <p className="typo-body text-muted-foreground/60">
          Create an Ed25519 digital signature using your local identity key. The signature is stored locally and a portable .sig.json sidecar is generated.
        </p>
      </div>

      {/* Signing identity */}
      {keyStatus && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15 text-xs">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-foreground/60">Signing as <span className="font-medium text-foreground/80">{keyStatus.display_name}</span></span>
          <span className="text-foreground/30 font-mono ml-auto">{keyStatus.peer_id.slice(0, 12)}...</span>
        </div>
      )}

      {/* File picker */}
      <button
        onClick={pickFile}
        className="w-full flex items-center justify-center gap-3 px-6 py-8 rounded-xl border-2 border-dashed border-primary/20 hover:border-rose-400/40 bg-primary/3 hover:bg-rose-500/5 transition-colors group"
      >
        <Upload className="w-6 h-6 text-muted-foreground/40 group-hover:text-rose-400/60 transition-colors" />
        <span className="typo-heading text-muted-foreground/60 group-hover:text-foreground/80 transition-colors">
          {filePath ? filePath.split(/[/\\]/).pop() : 'Choose file to sign'}
        </span>
      </button>
      {filePath && (
        <p className="text-[11px] text-muted-foreground/40 truncate">{filePath}</p>
      )}

      {/* Optional metadata */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground/50">Notes (optional)</label>
        <input
          type="text"
          value={metadata}
          onChange={(e) => setMetadata(e.target.value)}
          placeholder="e.g., Contract approval, Invoice sign-off..."
          className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus-ring"
        />
      </div>

      {/* Sign button */}
      <button
        onClick={handleSign}
        disabled={!filePath || signing}
        className="w-full px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/25 text-rose-400 typo-heading hover:bg-rose-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {signing ? 'Signing...' : 'Sign Document'}
      </button>

      {/* Result */}
      {result && (
        <div className="space-y-3 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span className="typo-heading text-emerald-400">Signed successfully</span>
          </div>
          <pre className="text-[11px] text-muted-foreground/60 bg-black/20 rounded-lg p-3 overflow-x-auto max-h-48">
            {result.sidecarJson}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={handleSaveSidecar}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/8 border border-primary/15 text-xs text-foreground/70 hover:bg-primary/15 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Save .sig.json
            </button>
            <button
              onClick={handleCopySidecar}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/8 border border-primary/15 text-xs text-foreground/70 hover:bg-primary/15 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verify Panel
// ---------------------------------------------------------------------------

function VerifyPanel() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [sidecarJson, setSidecarJson] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyDocumentResult | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const pickFile = useCallback(async () => {
    const selected = await open({ multiple: false, directory: false });
    if (selected) {
      setFilePath(selected as string);
      setResult(null);
    }
  }, []);

  const loadSidecar = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Signature', extensions: ['sig.json', 'json'] }],
    });
    if (selected) {
      const content = await readSidecarFile(selected as string);
      setSidecarJson(content);
      setResult(null);
    }
  }, []);

  const handleVerify = useCallback(async () => {
    if (!filePath || !sidecarJson) return;
    setVerifying(true);
    try {
      const res = await verifyDocument(filePath, sidecarJson);
      setResult(res);
    } catch (e: unknown) {
      addToast(`Verification failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setVerifying(false);
    }
  }, [filePath, sidecarJson, addToast]);

  return (
    <div className="max-w-2xl mx-auto space-y-6 pt-4">
      <div className="space-y-2">
        <h2 className="typo-heading text-lg text-foreground/90">Verify a Signature</h2>
        <p className="typo-body text-muted-foreground/60">
          Check that a document has not been tampered with and that the signature is cryptographically valid.
        </p>
      </div>

      {/* File picker */}
      <button
        onClick={pickFile}
        className="w-full flex items-center justify-center gap-3 px-6 py-6 rounded-xl border-2 border-dashed border-primary/20 hover:border-sky-400/40 bg-primary/3 hover:bg-sky-500/5 transition-colors group"
      >
        <FileText className="w-5 h-5 text-muted-foreground/40 group-hover:text-sky-400/60 transition-colors" />
        <span className="typo-heading text-muted-foreground/60 group-hover:text-foreground/80 transition-colors">
          {filePath ? filePath.split(/[/\\]/).pop() : 'Choose file to verify'}
        </span>
      </button>

      {/* Sidecar input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground/50">Signature (.sig.json)</label>
          <button
            onClick={loadSidecar}
            className="text-[11px] text-primary/60 hover:text-primary/80 transition-colors"
          >
            Load from file
          </button>
        </div>
        <textarea
          value={sidecarJson}
          onChange={(e) => { setSidecarJson(e.target.value); setResult(null); }}
          placeholder="Paste .sig.json contents or load from file..."
          rows={6}
          className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10 text-xs text-foreground/80 placeholder:text-muted-foreground/30 focus-ring font-mono resize-none"
        />
      </div>

      {/* Verify button */}
      <button
        onClick={handleVerify}
        disabled={!filePath || !sidecarJson || verifying}
        className="w-full px-4 py-3 rounded-xl bg-sky-500/15 border border-sky-500/25 text-sky-400 typo-heading hover:bg-sky-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {verifying ? 'Verifying...' : 'Verify Signature'}
      </button>

      {/* Result */}
      {result && (
        <div
          className={`space-y-3 p-4 rounded-xl border ${
            result.valid
              ? 'bg-emerald-500/5 border-emerald-500/20'
              : 'bg-red-500/5 border-red-500/20'
          }`}
        >
          <div className="flex items-center gap-2">
            {result.valid ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400" />
            )}
            <span className={`typo-heading ${result.valid ? 'text-emerald-400' : 'text-red-400'}`}>
              {result.valid ? 'Valid signature' : 'Verification failed'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground/40">Signer</span>
              <p className="text-foreground/70">{result.signer_display_name || 'Unknown'}</p>
            </div>
            <div>
              <span className="text-muted-foreground/40">Signed at</span>
              <p className="text-foreground/70">
                {result.signed_at ? new Date(result.signed_at).toLocaleString() : 'N/A'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground/40">File integrity</span>
              <p className={result.file_hash_match ? 'text-emerald-400' : 'text-red-400'}>
                {result.file_hash_match ? 'Unchanged' : 'Modified'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground/40">Crypto signature</span>
              <p className={result.signature_valid ? 'text-emerald-400' : 'text-red-400'}>
                {result.signature_valid ? 'Valid' : 'Invalid'}
              </p>
            </div>
          </div>

          {result.error && (
            <p className="text-[11px] text-red-400/80">{result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History Panel
// ---------------------------------------------------------------------------

function HistoryPanel() {
  const [signatures, setSignatures] = useState<DocumentSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const addToast = useToastStore((s) => s.addToast);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listDocumentSignatures();
      setSignatures(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleExport = useCallback(async (sig: DocumentSignature) => {
    try {
      const json = await exportSignatureSidecar(sig.id);
      const path = await save({
        defaultPath: `${sig.file_name}.sig.json`,
        filters: [{ name: 'Signature', extensions: ['sig.json', 'json'] }],
      });
      if (path) {
        await writeSidecarFile(path, json);
        addToast('Sidecar exported', 'success');
      }
    } catch (e: unknown) {
      addToast(`Export failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [addToast]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteDocumentSignature(id);
      setSignatures((prev) => prev.filter((s) => s.id !== id));
      addToast('Signature deleted', 'success');
    } catch (e: unknown) {
      addToast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [addToast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <span className="text-sm text-muted-foreground/40">Loading...</span>
      </div>
    );
  }

  if (signatures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <FileSignature className="w-10 h-10 text-muted-foreground/20" />
        <p className="typo-heading text-muted-foreground/40">No signatures yet</p>
        <p className="text-xs text-muted-foreground/30">Sign a document to see it here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4">
      <h2 className="typo-heading text-lg text-foreground/90">Signature History</h2>
      <div className="space-y-2">
        {signatures.map((sig) => (
          <div
            key={sig.id}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary/20 border border-primary/8 hover:border-primary/15 transition-colors group"
          >
            <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/15 flex items-center justify-center flex-shrink-0">
              <FileSignature className="w-4 h-4 text-rose-400/70" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="typo-heading text-foreground/80 truncate">{sig.file_name}</p>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground/40">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(sig.signed_at).toLocaleString()}
                </span>
                <span className="truncate">by {sig.signer_display_name}</span>
              </div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleExport(sig)}
                title="Export .sig.json"
                className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDelete(sig.id)}
                title="Delete signature"
                className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-400/70 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
