import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Upload,
  FileJson,
  AlertCircle,
  Check,
  RefreshCw,
  Sparkles,
  Wrench,
  Zap,
  Link,
} from 'lucide-react';
import { parseN8nWorkflow } from '@/lib/personas/n8nParser';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { usePersonaStore } from '@/stores/personaStore';

export default function N8nImportTab() {
  const createPersona = usePersonaStore((s) => s.createPersona);
  const selectPersona = usePersonaStore((s) => s.selectPersona);

  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedResult, setParsedResult] = useState<DesignAnalysisResult | null>(null);
  const [workflowName, setWorkflowName] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    setError(null);
    setParsedResult(null);
    setCreated(false);

    if (!file.name.endsWith('.json')) {
      setError('Please upload a .json file exported from n8n.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        const result = parseN8nWorkflow(json);
        setParsedResult(result);
        setWorkflowName(json.name || 'Imported n8n Workflow');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse workflow file.');
      }
    };
    reader.onerror = () => setError('Failed to read the file.');
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleCreate = async () => {
    if (!parsedResult) return;
    setCreating(true);
    try {
      const persona = await createPersona({
        name: workflowName,
        description: parsedResult.summary,
        system_prompt: parsedResult.full_prompt_markdown,
      });
      setCreated(true);
      setTimeout(() => {
        selectPersona(persona.id);
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create persona.');
    } finally {
      setCreating(false);
    }
  };

  const handleReset = () => {
    setParsedResult(null);
    setError(null);
    setWorkflowName('');
    setCreated(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-6 overflow-y-auto h-full">
      {/* Drop zone */}
      {!parsedResult && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center gap-4 p-12 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
            isDragOver
              ? 'border-violet-500/50 bg-violet-500/10'
              : 'border-primary/15 bg-secondary/20 hover:border-primary/30 hover:bg-secondary/30'
          }`}
        >
          <motion.div
            animate={isDragOver ? { scale: 1.1, y: -4 } : { scale: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="w-16 h-16 rounded-2xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center"
          >
            <Upload className="w-8 h-8 text-violet-400" />
          </motion.div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground/80">
              Drop your n8n workflow JSON here
            </p>
            <p className="text-xs text-muted-foreground/50 mt-1">
              or click to browse files
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground/40">
            <FileJson className="w-4 h-4" />
            <span>Accepts .json files exported from n8n</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="hidden"
          />
        </motion.div>
      )}

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20"
        >
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">Import Error</p>
            <p className="text-xs text-red-400/70 mt-0.5">{error}</p>
          </div>
        </motion.div>
      )}

      {/* Parsed result preview */}
      {parsedResult && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="space-y-4"
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center">
                <FileJson className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground/90">{workflowName}</h3>
                <p className="text-xs text-muted-foreground/50">{parsedResult.summary}</p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-xs rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/60 transition-colors"
            >
              Import Another
            </button>
          </div>

          {/* Preview sections */}
          <div className="rounded-xl border border-primary/10 bg-secondary/20 divide-y divide-primary/10">
            {/* Tools */}
            {parsedResult.suggested_tools.length > 0 && (
              <div className="p-4">
                <h4 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Wrench className="w-3 h-3" />
                  Tools ({parsedResult.suggested_tools.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {parsedResult.suggested_tools.map((tool) => (
                    <span
                      key={tool}
                      className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Triggers */}
            {parsedResult.suggested_triggers.length > 0 && (
              <div className="p-4">
                <h4 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  Triggers ({parsedResult.suggested_triggers.length})
                </h4>
                <div className="space-y-1.5">
                  {parsedResult.suggested_triggers.map((trigger, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-foreground/60">
                      <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {trigger.trigger_type}
                      </span>
                      <span className="truncate">{trigger.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Connectors */}
            {parsedResult.suggested_connectors && parsedResult.suggested_connectors.length > 0 && (
              <div className="p-4">
                <h4 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Link className="w-3 h-3" />
                  Connectors ({parsedResult.suggested_connectors.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {parsedResult.suggested_connectors.map((conn) => (
                    <span
                      key={conn.name}
                      className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    >
                      {conn.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={creating || created}
            className={`w-full px-4 py-3 text-sm font-medium rounded-xl border transition-colors flex items-center justify-center gap-2 ${
              created
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                : 'bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25'
            }`}
          >
            {created ? (
              <>
                <Check className="w-4 h-4" />
                Persona Created
              </>
            ) : creating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Creating Persona...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Create Persona from Workflow
              </>
            )}
          </button>
        </motion.div>
      )}
    </div>
  );
}
