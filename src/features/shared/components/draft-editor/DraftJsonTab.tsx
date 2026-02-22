import { useState, useMemo, useRef, useCallback } from 'react';
import { Code, Copy, Check } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import type { N8nPersonaDraft } from '@/api/design';
import { normalizeDraftFromUnknown } from '@/features/templates/sub_n8n/n8nTypes';

hljs.registerLanguage('json', json);

interface DraftJsonTabProps {
  draftJson: string;
  draftJsonError: string | null;
  disabled: boolean;
  onJsonChange: (json: string, draft: N8nPersonaDraft | null, error: string | null) => void;
}

export function DraftJsonTab({ draftJson, draftJsonError, disabled, onJsonChange }: DraftJsonTabProps) {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const handleChange = (value: string) => {
    try {
      const parsed = normalizeDraftFromUnknown(JSON.parse(value));
      if (!parsed) {
        onJsonChange(value, null, 'JSON does not match expected persona draft shape.');
        return;
      }
      onJsonChange(value, parsed, null);
    } catch {
      onJsonChange(value, null, 'Invalid JSON syntax.');
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(draftJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Synchronize scroll between textarea and pre
  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  // Highlighted HTML
  const highlightedHtml = useMemo(() => {
    try {
      return hljs.highlight(draftJson, { language: 'json' }).value;
    } catch {
      // Fallback: escape and show plain
      return draftJson
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }, [draftJson]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Code className="w-3.5 h-3.5 text-muted-foreground/80" />
          <p className="text-sm text-muted-foreground/80">
            Edit raw JSON. Changes override form fields.
          </p>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg border border-primary/10 text-muted-foreground/80 hover:text-foreground/95 hover:bg-secondary/40 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Syntax-highlighted editor with overlay pattern */}
      <div className="relative rounded-xl border border-primary/15 overflow-hidden">
        {/* Highlighted pre (visual layer) */}
        <pre
          ref={preRef}
          className="absolute inset-0 p-3 text-sm font-mono leading-relaxed overflow-hidden pointer-events-none m-0 whitespace-pre-wrap break-words json-highlight"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlightedHtml + '\n' }}
        />
        {/* Editable textarea (input layer) */}
        <textarea
          ref={textareaRef}
          value={draftJson}
          onChange={(e) => handleChange(e.target.value)}
          onScroll={handleScroll}
          className="relative w-full h-72 p-3 text-sm font-mono leading-relaxed resize-y bg-transparent text-transparent caret-foreground/80 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all whitespace-pre-wrap break-words"
          style={{ caretColor: 'var(--foreground)' }}
          disabled={disabled}
          spellCheck={false}
        />
      </div>

      {draftJsonError && (
        <p className="text-sm text-red-400/80 px-1">{draftJsonError}</p>
      )}
    </div>
  );
}
