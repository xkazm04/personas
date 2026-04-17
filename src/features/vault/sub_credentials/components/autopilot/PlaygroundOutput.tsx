import { CheckCircle2, XCircle, Copy } from 'lucide-react';
import type { PlaygroundTestResult } from '@/lib/bindings/PlaygroundTestResult';

function formatJson(str: string): string {
  try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
}

interface PlaygroundOutputProps {
  error: string | null;
  testResult: PlaygroundTestResult | null;
}

export function PlaygroundOutput({ error, testResult }: PlaygroundOutputProps) {
  return (
    <>
      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-card text-sm text-red-400">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Response */}
      {testResult && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
              {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              <span className="text-sm font-medium">{testResult.statusCode}</span>
            </div>
            <span className="text-xs text-muted-foreground/50">{testResult.durationMs}ms</span>
            <button
              onClick={() => navigator.clipboard.writeText(testResult.body)}
              className="text-xs text-muted-foreground/50 hover:text-foreground flex items-center gap-1 ml-auto"
            >
              <Copy className="w-3 h-3" /> Copy
            </button>
          </div>

          {/* Response Headers (collapsed by default) */}
          <details className="text-xs">
            <summary className="text-muted-foreground/50 cursor-pointer hover:text-muted-foreground">
              Response Headers ({Object.keys(testResult.headers).length})
            </summary>
            <div className="mt-1 p-2 bg-secondary/20 rounded-card font-mono space-y-0.5 max-h-32 overflow-y-auto">
              {Object.entries(testResult.headers).map(([k, v]) => (
                <div key={k}>
                  <span className="text-blue-400">{k}</span>: <span className="text-muted-foreground/70">{v}</span>
                </div>
              ))}
            </div>
          </details>

          {/* Response Body */}
          <div className="relative">
            <pre className="p-3 bg-secondary/20 border border-primary/10 rounded-card text-xs font-mono text-foreground/80 overflow-auto max-h-80 whitespace-pre-wrap">
              {formatJson(testResult.body)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
