import { useState, useEffect, useCallback } from 'react';
import {
  ScanLine, Upload, Columns2, History, Trash2, Clock,
  Zap, Bot, CheckCircle2, Copy,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useToastStore } from '@/stores/toastStore';
import {
  ocrWithGemini,
  ocrWithClaude,
  listOcrDocuments,
  deleteOcrDocument,
  type OcrDocument,
  type OcrResult,
} from '@/api/ocr';

type Tab = 'extract' | 'compare' | 'history';
type Provider = 'gemini' | 'claude';

export default function OcrPage() {
  const [tab, setTab] = useState<Tab>('extract');

  const tabs: { id: Tab; label: string; icon: typeof ScanLine }[] = [
    { id: 'extract', label: 'Extract', icon: ScanLine },
    { id: 'compare', label: 'Compare', icon: Columns2 },
    { id: 'history', label: 'History', icon: History },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-4 pt-4 pb-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg typo-heading transition-colors ${
                tab === t.id
                  ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                  : 'text-muted-foreground/60 hover:bg-secondary/40 hover:text-foreground/80 border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>
      <div
          key={tab}
          className="animate-fade-slide-in flex-1 min-h-0 overflow-y-auto px-4 pb-4"
        >
          {tab === 'extract' && <ExtractPanel />}
          {tab === 'compare' && <ComparePanel />}
          {tab === 'history' && <HistoryPanel />}
        </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared: File picker + Provider selector
// ---------------------------------------------------------------------------

function FilePicker({ filePath, onPick }: { filePath: string | null; onPick: (p: string) => void }) {
  const pick = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Documents & Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'bmp', 'tiff', 'tif'] }],
    });
    if (selected) onPick(selected as string);
  }, [onPick]);

  return (
    <button
      onClick={pick}
      className="w-full flex items-center justify-center gap-3 px-6 py-8 rounded-xl border-2 border-dashed border-primary/20 hover:border-violet-400/40 bg-primary/3 hover:bg-violet-500/5 transition-colors group"
    >
      <Upload className="w-6 h-6 text-muted-foreground/40 group-hover:text-violet-400/60 transition-colors" />
      <span className="typo-heading text-muted-foreground/60 group-hover:text-foreground/80 transition-colors">
        {filePath ? filePath.split(/[/\\]/).pop() : 'Choose image or PDF'}
      </span>
    </button>
  );
}

function ProviderSelector({ value, onChange }: { value: Provider; onChange: (p: Provider) => void }) {
  return (
    <div className="flex gap-2">
      <button
        onClick={() => onChange('gemini')}
        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border transition-colors ${
          value === 'gemini'
            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
            : 'border-primary/10 text-muted-foreground/50 hover:border-primary/20'
        }`}
      >
        <Zap className="w-4 h-4" />
        <span className="typo-heading">Gemini Vision</span>
        <span className="text-[10px] text-muted-foreground/40">API</span>
      </button>
      <button
        onClick={() => onChange('claude')}
        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border transition-colors ${
          value === 'claude'
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            : 'border-primary/10 text-muted-foreground/50 hover:border-primary/20'
        }`}
      >
        <Bot className="w-4 h-4" />
        <span className="typo-heading">Claude Vision</span>
        <span className="text-[10px] text-muted-foreground/40">CLI</span>
      </button>
    </div>
  );
}

function ResultBlock({ result, label, accent }: { result: OcrResult | null; label: string; accent: string }) {
  const addToast = useToastStore((s) => s.addToast);
  if (!result) return null;
  const d = result.document;
  return (
    <div className={`space-y-3 p-4 rounded-xl bg-${accent}-500/5 border border-${accent}-500/20`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className={`w-4 h-4 text-${accent}-400`} />
          <span className={`typo-heading text-${accent}-400`}>{label}</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/40">
          <span>{d.duration_ms}ms</span>
          {d.token_count && <span>{d.token_count} tokens</span>}
          <span>{d.model}</span>
        </div>
      </div>
      <pre className="text-xs text-foreground/70 bg-black/20 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap">
        {d.extracted_text || '(no text extracted)'}
      </pre>
      <button
        onClick={() => { navigator.clipboard.writeText(d.extracted_text); addToast('Copied', 'success'); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/8 border border-primary/15 text-xs text-foreground/70 hover:bg-primary/15 transition-colors"
      >
        <Copy className="w-3.5 h-3.5" /> Copy text
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extract Panel (single provider)
// ---------------------------------------------------------------------------

function ExtractPanel() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>('gemini');
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OcrResult | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const run = useCallback(async () => {
    if (!filePath) return;
    setRunning(true);
    setResult(null);
    try {
      const res = provider === 'gemini'
        ? await ocrWithGemini(filePath, geminiKey, geminiModel, prompt || undefined)
        : await ocrWithClaude(filePath, prompt || undefined);
      setResult(res);
      addToast(`Extracted ${res.document.extracted_text.length} chars in ${res.document.duration_ms}ms`, 'success');
    } catch (e: any) {
      addToast(`OCR failed: ${e?.message || e}`, 'error');
    } finally {
      setRunning(false);
    }
  }, [filePath, provider, geminiKey, geminiModel, prompt, addToast]);

  return (
    <div className="max-w-2xl mx-auto space-y-5 pt-4">
      <div className="space-y-2">
        <h2 className="typo-heading text-lg text-foreground/90">Extract Text</h2>
        <p className="typo-body text-muted-foreground/60">
          Upload an image or PDF and extract text using Gemini Vision API or Claude Code CLI.
        </p>
      </div>

      <FilePicker filePath={filePath} onPick={(p) => { setFilePath(p); setResult(null); }} />
      <ProviderSelector value={provider} onChange={(p) => { setProvider(p); setResult(null); }} />

      {provider === 'gemini' && (
        <div className="space-y-3">
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder="Gemini API Key (AIza...)"
            className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus-ring"
          />
          <select
            value={geminiModel}
            onChange={(e) => setGeminiModel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10 text-sm text-foreground/80 focus-ring"
          >
            <option value="gemini-3-flash-preview">Gemini 3 Flash Preview (latest)</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash (fast, free tier)</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro (most accurate)</option>
          </select>
        </div>
      )}

      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Custom prompt (optional, e.g. 'Extract invoice fields as JSON')"
        className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus-ring"
      />

      <button
        onClick={run}
        disabled={!filePath || running || (provider === 'gemini' && !geminiKey)}
        className="w-full px-4 py-3 rounded-xl bg-violet-500/15 border border-violet-500/25 text-violet-400 typo-heading hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {running ? 'Extracting...' : 'Extract Text'}
      </button>

      <ResultBlock result={result} label="Extraction complete" accent="emerald" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare Panel (side-by-side)
// ---------------------------------------------------------------------------

function ComparePanel() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [geminiKey, setGeminiKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [geminiResult, setGeminiResult] = useState<OcrResult | null>(null);
  const [claudeResult, setClaudeResult] = useState<OcrResult | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const runBoth = useCallback(async () => {
    if (!filePath) return;
    setRunning(true);
    setGeminiResult(null);
    setClaudeResult(null);

    const p = prompt || undefined;

    // Run both in parallel
    const [gRes, cRes] = await Promise.allSettled([
      geminiKey ? ocrWithGemini(filePath, geminiKey, 'gemini-2.5-flash', p) : Promise.reject('No Gemini key'),
      ocrWithClaude(filePath, p),
    ]);

    if (gRes.status === 'fulfilled') setGeminiResult(gRes.value);
    else if (geminiKey) addToast(`Gemini failed: ${(gRes as PromiseRejectedResult).reason}`, 'error');

    if (cRes.status === 'fulfilled') setClaudeResult(cRes.value);
    else addToast(`Claude failed: ${(cRes as PromiseRejectedResult).reason}`, 'error');

    setRunning(false);
  }, [filePath, geminiKey, prompt, addToast]);

  return (
    <div className="space-y-5 pt-4">
      <div className="space-y-2">
        <h2 className="typo-heading text-lg text-foreground/90">Side-by-Side Comparison</h2>
        <p className="typo-body text-muted-foreground/60">
          Run both providers on the same file and compare outputs. Gemini uses API key, Claude uses your subscription.
        </p>
      </div>

      <div className="max-w-2xl mx-auto space-y-4">
        <FilePicker filePath={filePath} onPick={(p) => { setFilePath(p); setGeminiResult(null); setClaudeResult(null); }} />

        <input
          type="password"
          value={geminiKey}
          onChange={(e) => setGeminiKey(e.target.value)}
          placeholder="Gemini API Key (optional — leave empty to run Claude only)"
          className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus-ring"
        />

        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Custom prompt (optional)"
          className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus-ring"
        />

        <button
          onClick={runBoth}
          disabled={!filePath || running}
          className="w-full px-4 py-3 rounded-xl bg-violet-500/15 border border-violet-500/25 text-violet-400 typo-heading hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {running ? 'Running both providers...' : 'Compare'}
        </button>
      </div>

      {/* Side-by-side results */}
      {(geminiResult || claudeResult) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <div>
            {geminiResult
              ? <ResultBlock result={geminiResult} label="Gemini Vision" accent="blue" />
              : <div className="p-4 rounded-xl bg-secondary/10 border border-primary/10 text-center text-xs text-muted-foreground/40">
                  {geminiKey ? 'Gemini failed or still running' : 'No Gemini API key provided'}
                </div>
            }
          </div>
          <div>
            {claudeResult
              ? <ResultBlock result={claudeResult} label="Claude Vision (CLI)" accent="amber" />
              : <div className="p-4 rounded-xl bg-secondary/10 border border-primary/10 text-center text-xs text-muted-foreground/40">
                  Claude still running or failed
                </div>
            }
          </div>
        </div>
      )}

      {/* Stats comparison */}
      {geminiResult && claudeResult && (
        <div className="max-w-2xl mx-auto p-4 rounded-xl bg-primary/5 border border-primary/10">
          <h3 className="typo-heading text-sm text-foreground/70 mb-3">Comparison Stats</h3>
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground/40">Metric</span>
              <p className="text-foreground/60 font-medium mt-1">Speed</p>
              <p className="text-foreground/60 font-medium mt-1">Text length</p>
              <p className="text-foreground/60 font-medium mt-1">Tokens</p>
            </div>
            <div>
              <span className="text-blue-400/60">Gemini</span>
              <p className="text-foreground/70 mt-1">{geminiResult.document.duration_ms}ms</p>
              <p className="text-foreground/70 mt-1">{geminiResult.document.extracted_text.length} chars</p>
              <p className="text-foreground/70 mt-1">{geminiResult.document.token_count ?? '—'}</p>
            </div>
            <div>
              <span className="text-amber-400/60">Claude</span>
              <p className="text-foreground/70 mt-1">{claudeResult.document.duration_ms}ms</p>
              <p className="text-foreground/70 mt-1">{claudeResult.document.extracted_text.length} chars</p>
              <p className="text-foreground/70 mt-1">{claudeResult.document.token_count ?? '—'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History Panel
// ---------------------------------------------------------------------------

function HistoryPanel() {
  const [docs, setDocs] = useState<OcrDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const addToast = useToastStore((s) => s.addToast);

  const load = useCallback(async () => {
    setLoading(true);
    try { setDocs(await listOcrDocuments()); } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteOcrDocument(id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
    addToast('Deleted', 'success');
  }, [addToast]);

  if (loading) return <div className="flex items-center justify-center h-48"><span className="text-sm text-muted-foreground/40">Loading...</span></div>;

  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <ScanLine className="w-10 h-10 text-muted-foreground/20" />
        <p className="typo-heading text-muted-foreground/40">No OCR results yet</p>
        <p className="text-xs text-muted-foreground/30">Extract text from a document to see it here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4">
      <h2 className="typo-heading text-lg text-foreground/90">OCR History</h2>
      <div className="space-y-2">
        {docs.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary/20 border border-primary/8 hover:border-primary/15 transition-colors group"
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
              d.provider === 'gemini'
                ? 'bg-blue-500/10 border border-blue-500/15'
                : 'bg-amber-500/10 border border-amber-500/15'
            }`}>
              {d.provider === 'gemini'
                ? <Zap className="w-4 h-4 text-blue-400/70" />
                : <Bot className="w-4 h-4 text-amber-400/70" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="typo-heading text-foreground/80 truncate">{d.file_name}</p>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground/40">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(d.created_at).toLocaleString()}
                </span>
                <span>{d.provider} / {d.model}</span>
                <span>{d.duration_ms}ms</span>
                <span>{d.extracted_text.length} chars</span>
              </div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => { navigator.clipboard.writeText(d.extracted_text); addToast('Copied', 'success'); }}
                className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDelete(d.id)}
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
